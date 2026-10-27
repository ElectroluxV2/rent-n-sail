const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const detect = require('../actions/component-changes/detect.cjs');
const neon = require('../actions/neon-operation/neon.cjs');
const deploy = require('../actions/vercel-prebuilt-deploy/deploy.cjs');
const { packageFrontend } = require('../actions/vercel-prebuilt-deploy/output.cjs');
const { Providers, aliasName } = require('../actions/_shared/providers.cjs');
const { commandEnvironment, buildEnvironment } = require('../actions/_shared/commands.cjs');

const root = path.resolve(__dirname, '../..');
function coreMock() {
  return {
    outputs: {},
    variables: {},
    secrets: [],
    logs: [],
    setOutput(key, value) {
      this.outputs[key] = value;
    },
    exportVariable(key, value) {
      this.variables[key] = value;
    },
    setSecret(value) {
      this.secrets.push(value);
    },
    info(value) {
      this.logs.push(value);
    },
    summary: {
      addHeading() {
        return this;
      },
      addRaw() {
        return this;
      },
      async write() {},
    },
  };
}
async function withEnv(values, body) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    return await body();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
async function temporary(t) {
  const directory = await fs.mkdtemp(
    path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'rns-cicd-'),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

for (const [name, files, changed] of [
  ['modified path', [{ filename: 'backend/main.py' }], true],
  ['unrelated path', [{ filename: 'frontend/main.ts' }], false],
  ['rename source', [{ filename: 'frontend/moved', previous_filename: 'backend/old' }], true],
  ['newline path', [{ filename: 'backend/line\nbreak' }], true],
  ['empty comparison', [], false],
  ['below cap', Array.from({ length: 299 }, (_, i) => ({ filename: `frontend/${i}` })), false],
  ['at cap', Array.from({ length: 300 }, (_, i) => ({ filename: `frontend/${i}` })), true],
])
  test(`changed paths: ${name}`, async () => {
    const core = coreMock();
    await withEnv({ CHECK_PATH: 'backend/' }, () =>
      detect({
        core,
        context: {
          repo: { owner: 'owner', repo: 'repo' },
          payload: { before: 'old', after: 'new' },
        },
        github: {
          async request(_route, options) {
            assert.equal(options.basehead, 'old...new');
            return { data: { status: 'ahead', files } };
          },
        },
        exec: {
          async exec(program, args, options) {
            assert.deepEqual([program, ...args], ['jq', '-C', '.']);
            const result = spawnSync(program, args, { input: options.input, encoding: 'utf8' });
            assert.equal(result.status, 0);
            assert.match(result.stdout, /\u001b\[/);
          },
        },
      }),
    );
    assert.equal(core.outputs.changed, changed);
  });

for (const component of ['frontend', 'backend'])
  test(`${component}: unchanged deployment is read-only`, async () => {
    const core = coreMock();
    const env = {
      COMPONENT: component,
      VERCEL_PROJECT_ID: component,
      DEPLOY_BRANCH: 'branch',
      DEPLOY_TARGET: 'preview',
    };
    const provider = new Providers({ core, env });
    provider.latest = async (id) => {
      assert.equal(id, component);
      return { uid: 'existing-id', name: component, url: 'immutable.vercel.app' };
    };
    provider.alias = async () => ({ deploymentId: 'existing-id' });
    provider.project =
      provider.assign =
      provider.connection =
      provider.branch =
        () => {
          throw new Error(
            'Unchanged applications must not resolve dependencies or mutate provider state.',
          );
        };
    await deploy.reuse(provider);
    assert.equal(core.outputs.deployment_id, 'existing-id');
    assert.equal(core.outputs.url, `https://${aliasName(component, 'branch', 'preview')}`);
  });

test('latest deployment lookup filters at Vercel rather than scanning history', async (t) => {
  const env = {
    VERCEL_TOKEN: 'token',
    VERCEL_ORG_ID: 'team',
    DEPLOY_BRANCH: 'feature/a',
    DEPLOY_TARGET: 'preview',
  };
  const provider = new Providers({ core: coreMock(), env });
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(url.pathname, '/v7/deployments');
    assert.equal(url.searchParams.get('projectId'), 'project');
    assert.equal(url.searchParams.get('limit'), '1');
    assert.equal(url.searchParams.get('state'), 'READY');
    assert.equal(
      url.searchParams.get('branch'),
      url.searchParams.get('target') === 'preview' ? 'feature/a' : null,
    );
    return Response.json({ deployments: [{ uid: 'latest' }] });
  });
  assert.equal((await provider.latest('project')).uid, 'latest');
  assert.equal((await provider.latest('project', 'production')).uid, 'latest');
  provider.request = async () => ({ deployments: [] });
  await assert.rejects(provider.latest('project'), /build=true once/);
});

test('Neon preview preparation is idempotent and uses the selected parent', async () => {
  const provider = new Providers({
    core: coreMock(),
    env: { NEON_PROJECT_ID: 'project', DEPLOY_BRANCH: 'branch', DEPLOY_TARGET: 'preview' },
  });
  const branches = [{ id: 'parent', default: true }];
  let created = 0;
  provider.request = async (_kind, method, _route, { data } = {}) => {
    if (method === 'GET') return { branches };
    assert.deepEqual(data, {
      branch: { name: 'preview/branch', parent_id: 'parent' },
      endpoints: [{ type: 'read_write' }],
    });
    created++;
    const branch = { id: 'preview', name: 'preview/branch' };
    branches.push(branch);
    return { branch };
  };
  assert.equal(await provider.branch(true), 'preview');
  assert.equal(await provider.branch(true), 'preview');
  assert.equal(created, 1);
});

test('migration credentials are masked and remain within the consuming job', async (t) => {
  const core = coreMock();
  const uri = 'postgresql://owner:password@database.test/neondb';
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(url.pathname, '/api/v2/projects/project/connection_uri');
    assert.equal(url.searchParams.get('pooled'), 'false');
    return Response.json({ uri });
  });
  await withEnv(
    {
      NEON_OPERATION: 'database-env',
      NEON_PROJECT_ID: 'project',
      NEON_API_KEY: 'key',
      NEON_BRANCH_ID: 'preview',
    },
    async () => {
      assert.equal(await neon({ core }), undefined);
    },
  );
  assert.deepEqual(core.outputs, {});
  assert.equal(core.variables.DATABASE_URL, uri);
  assert.ok(core.secrets.includes(uri));
  assert.ok(!core.logs.join('\n').includes('password'));
});

test('provider failures cannot disclose connection details', async (t) => {
  const provider = new Providers({ core: coreMock(), env: { NEON_API_KEY: 'key' } });
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ message: 'postgresql://private' }, { status: 403 }),
  );
  await assert.rejects(provider.request('neon', 'GET', '/projects'), /HTTP 403/);
  assert.equal(
    provider.sanitize('key postgresql://owner:password@host/db'),
    '<REDACTED> <REDACTED DATABASE URL>',
  );
});

test('alias ownership remains explicit', async () => {
  const provider = new Providers({ core: coreMock() });
  provider.request = async () => ({ projectId: 'other' });
  await assert.rejects(provider.alias('preview.vercel.app', 'project'), /another project/);
});

test('package/build subprocesses do not receive github-script action inputs', () => {
  const env = {
    'INPUT_GITHUB-TOKEN': 'input',
    GITHUB_TOKEN: 'github',
    NEON_API_KEY: 'neon',
    DATABASE_URL: 'database',
    VERCEL_TOKEN: 'vercel',
    PUBLIC: 'public',
  };
  assert.equal(commandEnvironment(env)['INPUT_GITHUB-TOKEN'], undefined);
  assert.deepEqual(buildEnvironment(env), { VERCEL_TOKEN: 'vercel', PUBLIC: 'public' });
});

test('frontend packaging uses the validated browser and SSR bundles', async (t) => {
  const directory = await temporary(t);
  const dist = path.join(directory, 'dist');
  await fs.mkdir(path.join(dist, 'server'), { recursive: true });
  await fs.mkdir(path.join(dist, 'browser'));
  await fs.writeFile(path.join(dist, 'server/server.mjs'), 'export default () => {};');
  await fs.writeFile(path.join(dist, 'browser/main.js'), 'compiled browser');
  const output = path.join(directory, 'output');
  await packageFrontend(dist, output);
  assert.equal(await fs.readFile(path.join(output, 'static/main.js'), 'utf8'), 'compiled browser');
  assert.equal(
    JSON.parse(await fs.readFile(path.join(output, 'functions/ssr.func/.vc-config.json'))).handler,
    'server/server.mjs',
  );
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(output, 'config.json'))).routes, [
    { handle: 'filesystem' },
    { src: '/(.*)', dest: '/ssr' },
  ]);
});

for (const target of ['preview', 'production'])
  test(`${target} publication binds private runtime configuration, not command-line secret values`, async (t) => {
    const directory = await temporary(t);
    const previous = process.cwd();
    process.chdir(directory);
    try {
      const fn = '.vercel/output/functions/app.func';
      await fs.mkdir(fn, { recursive: true });
      await fs.writeFile(
        path.join(fn, '.vc-config.json'),
        JSON.stringify({ filePathMap: { 'app.py': 'backend/main.py' } }),
      );
      const core = coreMock();
      const env = {
        COMPONENT: 'backend',
        VERCEL_PROJECT_ID: 'backend',
        VERCEL_FRONTEND_PROJECT_ID: 'frontend',
        VERCEL_LOCAL_CONFIG: 'vercel.json',
        DEPLOY_BRANCH: 'branch',
        DEPLOY_TARGET: target,
        GITHUB_SHA: 'sha',
      };
      const provider = new Providers({ core, env });
      provider.project = async (name) => ({ name });
      let frontendChecks = 0;
      provider.alias = async (_hostname, project) => {
        assert.equal(project, 'frontend');
        frontendChecks++;
        return { projectId: 'frontend' };
      };
      provider.branch = async () => 'preview-db';
      provider.connection = async () => provider.secret('postgresql://private');
      provider.request = async () => ({ id: 'published' });
      provider.assign = async (_host, project, id) =>
        assert.deepEqual([project, id], ['backend', 'published']);
      const exec = {
        async getExecOutput(program, args, options) {
          assert.equal(program, 'vercel');
          assert.ok(args.includes('--prebuilt') && args.includes('DATABASE_URL'));
          assert.ok(!args.join(' ').includes('postgresql://'));
          assert.equal(options.env.DATABASE_URL, 'postgresql://private');
          return {
            exitCode: 0,
            stdout: 'https://published.vercel.app\n',
            stderr: 'postgresql://private',
          };
        },
      };
      await deploy.publish(provider, exec);
      const config = JSON.parse(await fs.readFile(path.join(fn, '.vc-config.json')));
      assert.equal(config.environment.DATABASE_URL, 'postgresql://private');
      assert.deepEqual(config.filePathMap, { 'app.py': 'backend/main.py' });
      assert.ok(!core.logs.join('\n').includes('postgresql://private'));
      assert.equal(core.outputs.deployment_id, 'published');
      assert.equal(frontendChecks, 1);
    } finally {
      process.chdir(previous);
    }
  });

test('workflows retain the ordered stack without an artifact or restore protocol', async () => {
  const stack = await fs.readFile(path.join(root, '.github/workflows/stack.yml'), 'utf8');
  assert.deepEqual(
    [...stack.matchAll(/^  (database|backend|frontend):$/gm)].map((match) => match[1]),
    ['database', 'backend', 'frontend'],
  );
  const action = await fs.readFile(
    path.join(root, '.github/actions/vercel-prebuilt-deploy/action.yml'),
    'utf8',
  );
  assert.ok(!/upload-artifact|download-artifact|restore|actions\/checkout/.test(action));
  const database = await fs.readFile(
    path.join(root, '.github/workflows/reusable-database.yml'),
    'utf8',
  );
  assert.match(database, /alembic upgrade head/);
  assert.equal((database.match(/steps\.reference\.outputs\.branch_id/g) ?? []).length, 4);
  for (const component of ['database', 'backend', 'frontend']) {
    const workflow = await fs.readFile(
      path.join(root, `.github/workflows/reusable-${component}.yml`),
      'utf8',
    );
    assert.match(workflow, /runs-on: ubuntu-26\.04/);
    assert.match(workflow, /name: \*environment/);
    assert.ok(!/uses:.*reusable-(backend|frontend|database)/.test(workflow));
  }
});
