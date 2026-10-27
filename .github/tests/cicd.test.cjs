const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const detect = require('../actions/component-changes/detect.cjs');
const neon = require('../actions/neon-operation/neon.cjs');
const deploy = require('../actions/vercel-prebuilt-deploy/deploy.cjs');
const artifacts = require('../actions/vercel-prebuilt-deploy/artifacts.cjs');
const setup = require('../actions/setup-vercel-cli/setup.cjs');
const {
  Providers,
  aliasName,
  selectDeployment,
  writePrivate,
} = require('../actions/_shared/providers.cjs');
const { commandEnvironment, buildEnvironment } = require('../actions/_shared/commands.cjs');

const root = path.resolve(__dirname, '../..');
function coreMock() {
  const core = {
    logs: [],
    outputs: {},
    variables: {},
    secrets: [],
    paths: [],
    info(value) {
      this.logs.push(String(value));
    },
    setOutput(key, value) {
      this.outputs[key] = value;
    },
    exportVariable(key, value) {
      this.variables[key] = value;
    },
    setSecret(value) {
      this.secrets.push(value);
    },
    addPath(value) {
      this.paths.push(value);
    },
  };
  core.summary = {
    text: '',
    addHeading(value) {
      this.text += value;
      return this;
    },
    addRaw(value) {
      this.text += value;
      return this;
    },
    async write() {},
  };
  return core;
}
const nativeExec = {
  async getExecOutput(program, args, options = {}) {
    const result = spawnSync(program, args, {
      env: options.env,
      input: options.input,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 ** 2,
    });
    if (result.error) throw result.error;
    return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
  },
};
async function temporary(t) {
  const directory = await fs.realpath(
    await fs.mkdtemp(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'rns-js-test-')),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}
async function withEnv(values, body) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await body();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
async function detectFixture(data, searched = 'backend/') {
  const core = coreMock();
  const calls = [];
  const context = {
    repo: { owner: 'owner', repo: 'repo' },
    payload: { before: 'old', after: 'new' },
  };
  const github = {
    async request(route, options) {
      assert.equal(route, 'GET /repos/{owner}/{repo}/compare/{basehead}');
      assert.equal(options.basehead, 'old...new');
      return { data };
    },
  };
  const exec = {
    async exec(program, args, options) {
      calls.push({ program, args, options });
      const result = await nativeExec.getExecOutput(program, args, options);
      assert.equal(result.exitCode, 0);
      assert.match(result.stdout, /\u001b\[/);
    },
  };
  await withEnv({ CHECK_PATH: searched }, () => detect({ github, context, core, exec }));
  return { core, calls };
}

for (const [name, files, searched, changed] of [
  [
    'modified/added/deleted files',
    [{ filename: 'backend/file' }, { filename: 'frontend/file' }],
    'backend/',
    true,
  ],
  ['unaffected paths', [{ filename: 'frontend/file' }], 'database/', false],
  ['arbitrary substring', [{ filename: 'frontend/added' }], 'end/add', true],
  [
    'rename source',
    [{ filename: 'frontend/moved', previous_filename: 'backend/old' }],
    'backend/',
    true,
  ],
  [
    'rename destination',
    [{ filename: 'frontend/moved', previous_filename: 'backend/old' }],
    'frontend/',
    true,
  ],
  ['newline filenames', [{ filename: 'backend/line\nbreak' }], 'backend/', true],
  ['empty comparison', [], 'backend/', false],
  [
    'below-cap actual matching',
    Array.from({ length: 299 }, (_, i) => ({ filename: `frontend/${i}` })),
    'backend/',
    false,
  ],
  [
    'capped conservative matching',
    Array.from({ length: 300 }, (_, i) => ({ filename: `frontend/${i}` })),
    'backend/',
    true,
  ],
])
  test(`detector: ${name}`, async () => {
    const { core, calls } = await detectFixture(
      { status: files.length ? 'ahead' : 'identical', files },
      searched,
    );
    assert.equal(core.outputs.changed, changed);
    assert.equal(calls[0].program, 'jq');
    assert.deepEqual(calls[0].args, ['-C', '.']);
    assert.ok(core.logs.some((line) => line.startsWith('Searched path:')));
    assert.ok(!JSON.stringify(core.outputs).includes('\u001b'));
  });

test('detector: failures are not converted to unchanged', async () => {
  await assert.rejects(detectFixture({ status: 'diverged', files: [] }), /forward/);
  await assert.rejects(detectFixture({ status: 'ahead' }), /metadata/);
  await withEnv({ CHECK_PATH: 'backend/' }, async () => {
    const core = coreMock();
    await assert.rejects(detect({ core, context: { payload: {} } }), /required/);
    await assert.rejects(
      detect({
        core,
        context: { payload: { before: 'a', after: 'b' }, repo: {} },
        github: {
          request: async () => {
            throw new Error('API unavailable');
          },
        },
      }),
      /API unavailable/,
    );
    assert.deepEqual(core.outputs, {});
  });
});

test('deployment mode preserves existing previews without fingerprint overrides', () => {
  assert.equal(deploy.resolveMode(false, { id: 'preview' }, { id: 'production' }), 'reuse');
  assert.equal(deploy.resolveMode(false, null, { id: 'production' }), 'restore');
  assert.equal(deploy.resolveMode(true, { id: 'preview' }, null), 'build');
  assert.throws(() => deploy.resolveMode(false, null, null), /build=true/);
  assert.equal(
    aliasName('frontend', 'branch', 'preview'),
    aliasName('frontend', 'branch', 'preview'),
  );
  assert.notEqual(
    aliasName('frontend', 'branch', 'preview'),
    aliasName('frontend', 'other', 'preview'),
  );
});

test('selection requires READY, matching branch, and matching target', () => {
  const values = [
    { id: 'wrong', state: 'READY', created: 3, meta: { githubCommitRef: 'other' } },
    { id: 'failed', state: 'ERROR', created: 4, meta: { githubCommitRef: 'branch' } },
    { id: 'production', state: 'READY', target: 'production', created: 5 },
    { id: 'preview', state: 'READY', created: 1, meta: { githubCommitRef: 'branch' } },
  ];
  assert.equal(selectDeployment(values, 'branch', 'preview').id, 'preview');
  assert.equal(selectDeployment(values, 'branch', 'production').id, 'production');
});

for (const component of ['backend', 'frontend'])
  test(`${component} reuse is read-only and needs no source/dependencies`, async (t) => {
    const directory = await temporary(t);
    const core = coreMock();
    const env = {
      COMPONENT: component,
      DEPLOY_BRANCH: 'branch',
      DEPLOY_TARGET: 'preview',
      BUILD_REQUESTED: 'false',
      STATE_FILE: path.join(directory, 'state.json'),
      [`VERCEL_${component.toUpperCase()}_PROJECT_ID`]: component,
    };
    const provider = new Providers({ core, env });
    provider.project = async (id) => {
      assert.equal(id, component);
      return { id, name: component };
    };
    provider.deployments = async (id) => {
      assert.equal(id, component);
      return [{ id: 'existing', state: 'READY', meta: { githubCommitRef: 'branch' } }];
    };
    provider.alias = async () => ({ deploymentId: 'existing' });
    provider.branch =
      provider.assign =
      provider.connection =
        async () => {
          throw new Error('Must not touch dependencies or provider state');
        };
    await deploy.plan(provider);
    const state = JSON.parse(await fs.readFile(env.STATE_FILE, 'utf8'));
    assert.equal(state.mode, 'reuse');
    assert.deepEqual(state.runtime, {});
    assert.equal((await fs.stat(env.STATE_FILE)).mode & 0o777, 0o600);
    await deploy.publish(
      provider,
      {
        getExecOutput: () => {
          throw new Error('No CLI on reuse');
        },
      },
      state,
    );
    assert.equal(core.outputs.deployment_id, 'existing');
  });

test('restore validates immutable production artifact provenance', async (t) => {
  const directory = await temporary(t);
  const env = {
    COMPONENT: 'backend',
    DEPLOY_BRANCH: 'branch',
    DEPLOY_TARGET: 'preview',
    BUILD_REQUESTED: 'false',
    STATE_FILE: path.join(directory, 'state.json'),
    VERCEL_BACKEND_PROJECT_ID: 'backend',
    VERCEL_FRONTEND_PROJECT_ID: 'frontend',
    GITHUB_REPOSITORY: 'owner/repo',
    GITHUB_REPOSITORY_ID: '99',
  };
  const provider = new Providers({ env, core: coreMock() });
  provider.project = async (id) => ({ id, name: id });
  provider.alias = async () => ({ projectId: 'frontend' });
  provider.deployments = async () => [
    {
      id: 'production',
      state: 'READY',
      target: 'production',
      meta: { rnsArtifactId: '123', rnsArtifactRunId: '42', rnsArtifactName: 'compiled' },
    },
  ];
  provider.branch = async () => 'preview-db';
  provider.connection = async () => 'postgresql://private-fixture';
  provider.request = async () => ({
    expired: false,
    name: 'compiled',
    workflow_run: { id: 42, head_repository_id: 99 },
  });
  await deploy.plan(provider);
  assert.equal(JSON.parse(await fs.readFile(env.STATE_FILE)).source.id, 'production');
  provider.request = async () => ({
    expired: false,
    name: 'compiled',
    workflow_run: { id: 42, head_repository_id: 100 },
  });
  await assert.rejects(deploy.plan(provider), /foreign/);
});

test('Neon branch creation is idempotent and inherits compute settings', async () => {
  const core = coreMock();
  const provider = new Providers({
    core,
    env: { NEON_PROJECT_ID: 'project', DEPLOY_BRANCH: 'branch', DEPLOY_TARGET: 'preview' },
  });
  const branches = [{ id: 'parent', name: 'main', default: true }];
  let created = 0;
  provider.request = async (kind, method, route, options) => {
    if (method === 'GET') return { branches };
    assert.deepEqual(options.data, {
      branch: { name: 'preview/branch', parent_id: 'parent' },
      endpoints: [{ type: 'read_write' }],
    });
    created++;
    branches.push({ id: 'preview', name: 'preview/branch' });
    return { branch: { id: 'preview' } };
  };
  assert.equal(await provider.branch(true), 'preview');
  assert.equal(await provider.branch(true), 'preview');
  assert.equal(created, 1);
  assert.ok(core.logs.some((line) => line.includes('Reusing existing')));
});

test('Neon credentials stay in job environment and never become script results/outputs', async (t) => {
  const core = coreMock();
  const uri = 'postgresql://owner:password@database.test/neondb';
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.match(url.pathname, /^\/api\/v2\/projects\/project\/connection_uri$/);
    assert.equal(url.searchParams.get('pooled'), 'false');
    return new Response(JSON.stringify({ uri }));
  });
  await withEnv(
    {
      NEON_OPERATION: 'database-env',
      NEON_PROJECT_ID: 'project',
      NEON_API_KEY: 'api-key',
      NEON_BRANCH_ID: 'preview',
    },
    async () => {
      assert.equal(await neon({ core, github: {} }), undefined);
    },
  );
  assert.deepEqual(core.outputs, {});
  assert.equal(core.variables.DATABASE_URL, uri);
  assert.ok(core.secrets.includes(uri));
  assert.ok(!core.logs.join('\n').includes('password'));
});

test('provider errors disclose neither credentials nor connection URLs', async () => {
  const provider = new Providers({
    core: coreMock(),
    env: { NEON_API_KEY: 'token-fixture' },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          message: 'Not allowed token-fixture postgresql://owner:password@host/db',
        }),
        { status: 412 },
      ),
  });
  await assert.rejects(provider.request('neon', 'POST', '/branches'), (error) => {
    assert.match(error.message, /Not allowed/);
    assert.ok(!error.message.includes('token-fixture') && !error.message.includes('password'));
    return true;
  });
});

test('invalid Neon parent/connection responses cannot succeed through logging', async () => {
  const provider = new Providers({
    core: coreMock(),
    env: { NEON_PROJECT_ID: 'project', DEPLOY_BRANCH: 'branch', DEPLOY_TARGET: 'preview' },
  });
  provider.request = async () => ({ branches: [] });
  await assert.rejects(provider.parent(), /production parent/);
  await assert.rejects(provider.branch(), /Run the database workflow first/);
  provider.request = async () => ({});
  await assert.rejects(provider.connection('preview', false), /database connection/);
});

test('action inputs and build credentials are not forwarded to subprocesses', () => {
  const env = {
    'INPUT_GITHUB-TOKEN': 'input-secret',
    GITHUB_TOKEN: 'github',
    GH_TOKEN: 'gh',
    NEON_API_KEY: 'neon',
    DATABASE_URL: 'database',
    VERCEL_TOKEN: 'vercel',
    PUBLIC: 'public',
  };
  assert.equal(commandEnvironment(env)['INPUT_GITHUB-TOKEN'], undefined);
  assert.deepEqual(buildEnvironment(env), { VERCEL_TOKEN: 'vercel', PUBLIC: 'public' });
});

test('CLI setup uses the PATH toolchain version and no installer credentials', async (t) => {
  const directory = await temporary(t);
  const core = coreMock();
  const exec = {
    async getExecOutput(program, args, options) {
      assert.equal(options.env['INPUT_GITHUB-TOKEN'], undefined);
      assert.equal(options.env.VERCEL_TOKEN, undefined);
      assert.equal(options.env.NEON_API_KEY, undefined);
      return { exitCode: 0, stdout: program === 'node' ? 'v24.22.1\n' : '12.15.0\n', stderr: '' };
    },
  };
  await withEnv(
    {
      CLI_OPERATION: 'prepare',
      RUNNER_TOOL_CACHE: directory,
      'INPUT_GITHUB-TOKEN': 'private',
      VERCEL_TOKEN: 'private',
      NEON_API_KEY: 'private',
    },
    () => setup({ core, exec }),
  );
  assert.equal(core.outputs['node-version'], 'v24.22.1');
  assert.equal(core.outputs['pnpm-version'], '12.15.0');
});

async function artifactFixture(t) {
  const directory = await temporary(t);
  const output = path.join(directory, 'output');
  const fn = path.join(output, 'functions/app.func');
  await fs.mkdir(fn, { recursive: true });
  await fs.writeFile(path.join(output, 'config.json'), '{"version":3}');
  await fs.writeFile(path.join(output, 'builds.json'), 'private CLI state');
  await fs.writeFile(path.join(fn, 'app.py'), 'portable app');
  await fs.writeFile(path.join(fn, '.env.local'), 'private-env');
  await fs.writeFile(
    path.join(fn, '.vc-config.json'),
    JSON.stringify({
      runtime: 'python3.14',
      environment: {
        DATABASE_URL: 'credential-fixture',
        VERCEL_TOKEN: 'token-fixture',
        PYTHONPATH: '.',
      },
    }),
  );
  return {
    directory,
    output,
    fn,
    archive: path.join(directory, 'build-output.tar.gz'),
    exec: nativeExec,
    component: 'backend',
    workspace: directory,
    temporary: directory,
    source: output,
    secrets: ['credential-fixture', 'token-fixture', 'private-env'],
  };
}

test('portable output strips private/target-bound data and can be rebound', async (t) => {
  const fixture = await artifactFixture(t);
  await artifacts.packOutput(fixture);
  const destination = path.join(fixture.directory, 'restored');
  await artifacts.restoreOutput({ ...fixture, destination });
  const config = path.join(destination, 'functions/app.func/.vc-config.json');
  assert.deepEqual(JSON.parse(await fs.readFile(config)).environment, { PYTHONPATH: '.' });
  await assert.rejects(fs.stat(path.join(destination, 'builds.json')));
  await assert.rejects(fs.stat(path.join(destination, 'functions/app.func/.env.local')));
  await artifacts.injectRuntime(destination, { DATABASE_URL: 'new-private' }, fixture.directory);
  assert.equal(JSON.parse(await fs.readFile(config)).environment.DATABASE_URL, 'new-private');
  await assert.rejects(
    artifacts.restoreOutput({ ...fixture, destination, component: 'frontend' }),
    /Incompatible/,
  );
});

test('Python application/vendor mappings are physically materialized', async (t) => {
  const fixture = await artifactFixture(t);
  await fs.mkdir(path.join(fixture.directory, 'application'));
  await fs.writeFile(path.join(fixture.directory, 'application/main.py'), 'application');
  await fs.writeFile(path.join(fixture.directory, 'application/dependency.py'), 'vendor');
  const metadata = path.join(fixture.fn, '.vc-config.json');
  await fs.writeFile(
    metadata,
    JSON.stringify({
      filePathMap: {
        'main.py': 'application/main.py',
        '_vendor/dependency.py': 'application/dependency.py',
      },
    }),
  );
  await artifacts.packOutput(fixture);
  assert.equal(await fs.readFile(path.join(fixture.fn, '_vendor/dependency.py'), 'utf8'), 'vendor');
  assert.equal(JSON.parse(await fs.readFile(metadata)).filePathMap, undefined);
});

test('checkout-local function symlinks are portable and can receive runtime bindings', async (t) => {
  const fixture = await artifactFixture(t);
  const actual = path.join(fixture.directory, 'linked-function');
  await fs.rename(fixture.fn, actual);
  await fs.symlink(actual, fixture.fn);
  await artifacts.packOutput(fixture);
  await artifacts.injectRuntime(
    fixture.output,
    { BACKEND_URL: 'https://backend.test' },
    fixture.directory,
  );
  assert.equal(
    JSON.parse(await fs.readFile(path.join(actual, '.vc-config.json'))).environment.BACKEND_URL,
    'https://backend.test',
  );
  const destination = path.join(fixture.directory, 'restored-link');
  await artifacts.restoreOutput({ ...fixture, destination });
  assert.equal(
    (await fs.lstat(path.join(destination, 'functions/app.func'))).isSymbolicLink(),
    false,
  );
});

for (const kind of ['embedded credential', 'external symlink', 'symlink cycle', 'mapped traversal'])
  test(`artifact rejection: ${kind}`, async (t) => {
    const fixture = await artifactFixture(t);
    if (kind === 'embedded credential')
      await fs.writeFile(path.join(fixture.fn, 'app.py'), 'credential-fixture');
    if (kind === 'external symlink')
      await fs.symlink('/etc/hosts', path.join(fixture.fn, 'external'));
    if (kind === 'symlink cycle') await fs.symlink(fixture.fn, path.join(fixture.fn, 'cycle'));
    if (kind === 'mapped traversal')
      await fs.writeFile(
        path.join(fixture.fn, '.vc-config.json'),
        JSON.stringify({ filePathMap: { '../escaped.py': 'application.py' } }),
      );
    await assert.rejects(
      artifacts.packOutput(fixture),
      /Credential|symlink|cycle|destination|escapes/,
    );
  });

test('archive links and traversal are rejected before extraction', async (t) => {
  const fixture = await artifactFixture(t);
  await fs.symlink('/', path.join(fixture.fn, 'link'));
  await nativeExec.getExecOutput('tar', [
    '-czf',
    fixture.archive,
    '-C',
    fixture.directory,
    'output',
  ]);
  await assert.rejects(
    artifacts.restoreOutput({ ...fixture, destination: path.join(fixture.directory, 'restored') }),
    /links/,
  );
});

test('restore rejects destinations outside the workspace/temporary roots', async (t) => {
  const fixture = await artifactFixture(t);
  await artifacts.packOutput(fixture);
  const outside = await temporary(t);
  const sentinel = path.join(outside, 'sentinel');
  await fs.writeFile(sentinel, 'keep');
  await assert.rejects(artifacts.restoreOutput({ ...fixture, destination: outside }), /Unsafe/);
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'keep');
  const link = path.join(fixture.directory, 'escape');
  await fs.symlink(outside, link);
  await assert.rejects(artifacts.restoreOutput({ ...fixture, destination: link }), /Unsafe/);
  await assert.rejects(
    artifacts.restoreOutput({ ...fixture, destination: process.cwd() }),
    /Unsafe/,
  );
});

test('frontend packaging uses only the compiled SSR/browser output', async (t) => {
  const directory = await temporary(t);
  const dist = path.join(directory, 'dist');
  const output = path.join(directory, '.vercel/output');
  await fs.mkdir(path.join(dist, 'server'), { recursive: true });
  await fs.mkdir(path.join(dist, 'browser'));
  await fs.writeFile(path.join(dist, 'server/server.mjs'), 'export default () => {};');
  await fs.writeFile(path.join(dist, 'browser/main.js'), 'compiled browser');
  await artifacts.packageFrontend({ dist, output, temporary: directory });
  const config = JSON.parse(await fs.readFile(path.join(output, 'config.json')));
  assert.deepEqual(config.routes, [{ handle: 'filesystem' }, { src: '/(.*)', dest: '/ssr' }]);
  const fn = path.join(output, 'functions/ssr.func');
  assert.equal(
    JSON.parse(await fs.readFile(path.join(fn, '.vc-config.json'))).handler,
    'server/server.mjs',
  );
  assert.equal(await fs.readFile(path.join(output, 'static/main.js'), 'utf8'), 'compiled browser');
  assert.equal(await fs.readFile(path.join(fn, 'browser/main.js'), 'utf8'), 'compiled browser');
  await assert.rejects(
    artifacts.packageFrontend({
      dist: path.join(directory, 'missing'),
      output,
      temporary: directory,
    }),
    /ENOENT/,
  );
  assert.equal(await fs.readFile(path.join(output, 'static/main.js'), 'utf8'), 'compiled browser');
});

test('publication binds secrets through environment, never command arguments', async (t) => {
  const fixture = await artifactFixture(t);
  const old = process.cwd();
  process.chdir(fixture.directory);
  try {
    await fs.mkdir('.vercel', { recursive: true });
    await fs.cp(fixture.output, '.vercel/output', { recursive: true });
    const core = coreMock();
    const env = {
      STATE_FILE: path.join(fixture.directory, 'state.json'),
      GITHUB_SHA: 'sha',
      BUILD_ARTIFACT_ID: '123',
      GITHUB_RUN_ID: '42',
      BUILD_ARTIFACT_NAME: 'compiled',
      VERCEL_LOCAL_CONFIG: 'vercel.json',
      'INPUT_GITHUB-TOKEN': 'input-token',
    };
    const state = {
      mode: 'build',
      component: 'backend',
      project_id: 'backend',
      branch: 'branch',
      target: 'preview',
      alias: 'backend.test',
      runtime: { DATABASE_URL: 'postgresql://private-fixture' },
    };
    const provider = new Providers({ core, env });
    provider.secret(state.runtime.DATABASE_URL);
    provider.request = async () => ({ id: 'published', readyState: 'READY' });
    provider.assign = async () => {};
    const exec = {
      async getExecOutput(program, args, options) {
        assert.equal(program, 'vercel');
        assert.ok(args.includes('--prebuilt') && args.includes('DATABASE_URL'));
        assert.ok(!args.join(' ').includes('private-fixture'));
        assert.equal(options.env.DATABASE_URL, state.runtime.DATABASE_URL);
        assert.equal(options.env['INPUT_GITHUB-TOKEN'], undefined);
        return {
          exitCode: 0,
          stdout: 'https://published.test\n',
          stderr: state.runtime.DATABASE_URL,
        };
      },
    };
    await withEnv({ GITHUB_WORKSPACE: fixture.directory }, () =>
      deploy.publish(provider, exec, state),
    );
    assert.equal(core.outputs.url, 'https://backend.test');
    assert.ok(!core.logs.join('\n').includes('private-fixture'));
  } finally {
    process.chdir(old);
  }
});

test('workflow structure and script interfaces retain the requested behavior', async () => {
  const automatic = await fs.readFile(path.join(root, '.github/workflows/stack.yml'), 'utf8');
  assert.deepEqual(
    [...automatic.matchAll(/^  (\w+):$/gm)]
      .map((match) => match[1])
      .filter((key) => ['database', 'backend', 'frontend'].includes(key)),
    ['database', 'backend', 'frontend'],
  );
  const detector = await fs.readFile(
    path.join(root, '.github/actions/component-changes/action.yml'),
    'utf8',
  );
  assert.ok(!detector.includes('actions/checkout'));
  assert.match(detector, /actions\/github-script@v9\.0\.0/);
  const database = await fs.readFile(
    path.join(root, '.github/workflows/reusable-database.yml'),
    'utf8',
  );
  assert.ok(
    !/Test migrations|pytest|steps.selection|inputs.build|Select migration path/.test(database),
  );
  assert.match(database, /alembic upgrade head/);
  assert.equal((database.match(/steps\.reference\.outputs\.branch_id/g) ?? []).length, 4);
  for (const component of ['backend', 'frontend', 'database']) {
    const workflow = await fs.readFile(
      path.join(root, `.github/workflows/reusable-${component}.yml`),
      'utf8',
    );
    assert.match(workflow, /uses: \$\/\.github\/actions\/component-changes/);
    assert.ok(!/uses:.*reusable-(backend|frontend|database)/.test(workflow));
    assert.match(workflow, /runs-on: ubuntu-26\.04/);
    assert.match(workflow, /name: Deployment/);
    assert.match(workflow, /group: &environment /);
    assert.match(workflow, /name: \*environment/);
    assert.ok(!workflow.includes('head.repo.full_name'));
  }
  const walk = async (directory) => {
    const result = [];
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) result.push(...(await walk(filename)));
      else result.push(filename);
    }
    return result;
  };
  const metadata = (await walk(path.join(root, '.github'))).filter((filename) =>
    /\.ya?ml$/.test(filename),
  );
  for (const filename of metadata) {
    const text = await fs.readFile(filename, 'utf8');
    assert.ok(
      !/shell: bash|\bif \[\[|\bprintf |\becho .*GITHUB_|\bbash .*\.sh/.test(text),
      `${filename} still contains Bash orchestration`,
    );
    assert.ok(!/name:.*(?:Verify|Debug|Diagnostics|Test CI scripts)/.test(text));
    for (const line of text
      .split('\n')
      .filter((value) => /^\s*- (?:name|uses|run|id|if|shell|env|with):/.test(value))) {
      assert.match(
        line,
        /^\s*- name: [^A-Za-z0-9]/,
        `Missing emoji-prefixed step name in ${filename}`,
      );
    }
  }
  assert.ok(!(await walk(path.join(root, '.github'))).some((filename) => filename.endsWith('.sh')));
  assert.equal(
    JSON.parse(await fs.readFile(path.join(root, 'frontend/vercel.json'))).buildCommand,
    '',
  );
});
