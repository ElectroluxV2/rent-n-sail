const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const deploy = require('../actions/vercel-prebuilt-deploy/deploy.cjs');
const { packageFrontend } = require('../actions/vercel-prebuilt-deploy/output.cjs');
const { createProviders } = require('../actions/provider-script/providers.cjs');
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
function fixture(handler, overrides = {}) {
  const core = coreMock();
  const env = {
    VERCEL_TOKEN: 'vercel-token',
    VERCEL_ORG_ID: 'team',
    VERCEL_PROJECT_ID: 'backend',
    VERCEL_FRONTEND_PROJECT_ID: 'frontend',
    VERCEL_BACKEND_PROJECT_ID: 'backend',
    NEON_PROJECT_ID: 'project',
    DEPLOY_BRANCH: 'feature/a',
    DEPLOY_TARGET: 'preview',
    ...overrides,
  };
  const calls = [];
  const method = (provider, operation) => async (params) => {
    const call = { provider, operation, params };
    calls.push(call);
    return handler(call);
  };
  const clients = {
    vercel: {
      projects: { getProject: method('vercel', 'getProject') },
      deployments: {
        getDeployments: method('vercel', 'getDeployments'),
        getDeployment: method('vercel', 'getDeployment'),
      },
      aliases: {
        getAlias: method('vercel', 'getAlias'),
        assignAlias: method('vercel', 'assignAlias'),
      },
    },
    neon: {
      branches: {
        list: (params) => ({ all: () => method('neon', 'listBranches')(params) }),
        create: method('neon', 'createBranch'),
      },
      postgres: { connectionString: method('neon', 'connectionString') },
    },
  };
  return { core, env, calls, providers: createProviders({ core, env, clients }) };
}
async function temporary(t) {
  const directory = await fs.mkdtemp(
    path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'rns-cicd-'),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

for (const component of ['frontend', 'backend'])
  test(`${component}: reuse is read-only and needs no database client`, async () => {
    const context = fixture(
      ({ provider, operation, params }) => {
        assert.equal(provider, 'vercel');
        if (operation === 'getDeployments') {
          assert.deepEqual(params, {
            teamId: 'team',
            projectId: component,
            branch: 'feature/a',
            target: 'preview',
            state: 'READY',
            limit: 1,
          });
          return {
            deployments: [{ uid: 'existing-id', name: component, url: 'immutable.vercel.app' }],
          };
        }
        assert.equal(operation, 'getAlias');
        return { projectId: component, deploymentId: 'existing-id' };
      },
      { COMPONENT: component, VERCEL_PROJECT_ID: component },
    );
    await deploy.reuse(context);
    assert.equal(context.core.outputs.deployment_id, 'existing-id');
    assert.match(context.core.outputs.url, new RegExp(`^https://${component}-preview-`));
    assert.equal(context.calls.length, 2);
    assert.deepEqual(context.core.secrets, []);
  });

test('production lookup omits the preview branch and missing deployments require explicit bootstrap', async () => {
  const context = fixture(({ params }) => {
    assert.equal(params.target, 'production');
    assert.equal(params.branch, undefined);
    return { deployments: [] };
  });
  await assert.rejects(
    context.providers.getApplicationDeploymentFor({ target: 'production' }),
    /build=true once/,
  );
});

test('database preview selection is exact and idempotent using the SDK paginator', async () => {
  let preview;
  let created = 0;
  const context = fixture(({ provider, operation, params }) => {
    assert.equal(provider, 'neon');
    assert.equal(params.projectId, 'project');
    if (operation === 'createBranch') {
      assert.deepEqual(params, {
        projectId: 'project',
        name: 'preview/feature/a',
        parent_id: 'parent',
      });
      preview = { id: 'preview', name: params.name };
      created++;
      return preview;
    }
    assert.equal(operation, 'listBranches');
    return params.search
      ? [{ id: 'wrong', name: 'preview/feature/a-extra' }, ...(preview ? [preview] : [])]
      : [{ id: 'parent', default: true }];
  });
  assert.equal(await context.providers.getDatabasePreviewFor({ create: true }), 'preview');
  assert.equal(await context.providers.getDatabasePreviewFor({ create: true }), 'preview');
  assert.equal(created, 1);
});

for (const operation of ['database-plan', 'database-branch', 'database-env'])
  test(`inline ${operation} dispatch keeps credentials within the job`, async () => {
    const uri = 'postgresql://owner:password@database.test/neondb';
    const context = fixture(
      ({ operation, params }) => {
        if (operation === 'listBranches')
          return [
            { id: 'parent', default: true },
            { id: 'preview', name: 'preview/branch' },
          ];
        assert.equal(operation, 'connectionString');
        assert.equal(params.branchId, 'preview');
        assert.equal(params.pooled, false);
        return uri;
      },
      { DEPLOY_BRANCH: 'branch' },
    );
    const values = {
      NEON_OPERATION: operation,
      NEON_BRANCH_ID: 'preview',
      PROVIDERS_MODULE: path.join(root, '.github/actions/provider-script/providers.cjs'),
    };
    const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
    Object.assign(process.env, values);
    try {
      const action = await fs.readFile(
        path.join(root, '.github/actions/neon-operation/action.yml'),
        'utf8',
      );
      const script = action.match(/script: \|\n((?: {10}.+\n)+)/)[1].replace(/^ {10}/gm, '');
      const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
      const loadProviders = (name) => {
        assert.equal(name, values.PROVIDERS_MODULE);
        return {
          createProviders: ({ core }) => {
            assert.equal(core, context.core);
            return context.providers;
          },
        };
      };
      assert.equal(
        await new AsyncFunction('require', 'core', script)(loadProviders, context.core),
        undefined,
      );
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    assert.deepEqual(
      context.core.outputs,
      operation === 'database-plan'
        ? { parent_branch_id: 'parent' }
        : operation === 'database-branch'
          ? { branch_id: 'preview' }
          : {},
    );
    if (operation === 'database-env') {
      assert.equal(context.core.variables.DATABASE_URL, uri);
      assert.ok(context.core.secrets.includes(uri));
    } else assert.deepEqual(context.core.variables, {});
    assert.ok(!context.core.logs.join('\n').includes('password'));
  });

test('SDK failures cannot disclose connection details', async () => {
  const context = fixture(
    () => {
      throw Object.assign(new Error('postgresql://private'), { status: 403 });
    },
    { NEON_API_KEY: 'key' },
  );
  await assert.rejects(context.providers.getDatabasePreviewFor(), (error) => {
    assert.match(error.message, /HTTP 403/);
    assert.ok(!error.message.includes('private'));
    return true;
  });
  assert.equal(
    context.providers.sanitize('key postgresql://owner:password@host/db'),
    '<REDACTED> <REDACTED DATABASE URL>',
  );
});

test('official SDKs load from the provider action pnpm installation on Node 24', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (input) => {
    calls.push(new URL(input.url ?? input).hostname);
    return Response.json(
      { error: { code: 'forbidden', message: 'postgresql://private' }, message: 'private' },
      { status: 403 },
    );
  });
  const providers = createProviders({
    core: coreMock(),
    env: {
      VERCEL_TOKEN: 'fixture-token',
      VERCEL_ORG_ID: 'team',
      VERCEL_PROJECT_ID: 'project',
      DEPLOY_TARGET: 'preview',
      DEPLOY_BRANCH: 'branch',
      NEON_API_KEY: 'fixture-key',
      NEON_PROJECT_ID: 'project',
    },
  });
  await assert.rejects(
    providers.getApplicationDeploymentFor(),
    /vercel request failed \(HTTP 403\)/,
  );
  await assert.rejects(providers.getProductionDatabase(), /neon request failed \(HTTP 403\)/);
  assert.deepEqual(calls, ['api.vercel.com', 'console.neon.tech']);
});

test('deployment helpers reject aliases belonging to another project', async () => {
  const context = fixture(({ operation }) =>
    operation === 'getDeployments'
      ? { deployments: [{ uid: 'existing', name: 'backend' }] }
      : { projectId: 'other' },
  );
  await assert.rejects(context.providers.getApplicationDeploymentFor(), /another project/);
  assert.ok(context.calls.every(({ operation }) => operation.startsWith('get')));
});

for (const target of ['preview', 'production'])
  test(`${target}: backend runtime owns its origin and selected database`, async () => {
    let frontendHost;
    const context = fixture(
      ({ operation, params }) => {
        if (operation === 'getProject') return { name: 'frontend' };
        if (operation === 'getAlias') {
          frontendHost = params.idOrAlias;
          if (target === 'preview') throw { statusCode: 404 };
          return { projectId: 'frontend' };
        }
        if (operation === 'getDeployments') {
          assert.equal(params.target, 'production');
          return { deployments: [{ uid: 'production-frontend' }] };
        }
        if (operation === 'assignAlias') {
          assert.equal(params.id, 'production-frontend');
          assert.equal(params.requestBody.alias, frontendHost);
          return {};
        }
        if (operation === 'listBranches')
          return [
            { id: 'parent', default: true },
            { id: 'preview', name: 'preview/feature/a' },
          ];
        assert.equal(operation, 'connectionString');
        assert.equal(params.branchId, target === 'preview' ? 'preview' : 'parent');
        assert.equal(params.pooled, true);
        return 'postgresql://private';
      },
      { DEPLOY_TARGET: target },
    );
    const runtime = await context.providers.getApplicationRuntimeFor({ application: 'backend' });
    assert.deepEqual(runtime, {
      CORS_ALLOWED_ORIGINS: `https://${frontendHost}`,
      DATABASE_URL: 'postgresql://private',
    });
    assert.ok(context.core.secrets.includes(runtime.DATABASE_URL));
    assert.deepEqual(context.core.outputs, {});
  });

test('frontend runtime uses the resolved backend and exposes no database credentials', async () => {
  let backendHost;
  const context = fixture(
    ({ provider, operation, params }) => {
      assert.equal(provider, 'vercel');
      if (operation === 'getDeployments')
        return { deployments: [{ uid: 'backend', name: 'backend' }] };
      if (operation === 'getAlias') {
        backendHost = params.idOrAlias;
        return { projectId: 'backend', deploymentId: 'backend' };
      }
      assert.equal(operation, 'getProject');
      assert.equal(params.idOrName, 'frontend');
      return { name: 'frontend' };
    },
    { VERCEL_PROJECT_ID: 'frontend' },
  );
  const runtime = await context.providers.getApplicationRuntimeFor({ application: 'frontend' });
  assert.equal(runtime.BACKEND_URL, `https://${backendHost}`);
  assert.match(runtime.FRONTEND_URL, /^https:\/\/frontend-preview-/);
  assert.deepEqual(Object.keys(runtime).sort(), ['BACKEND_URL', 'FRONTEND_URL']);
});

test('application URL stays stable across commits while publication records the new deployment', async () => {
  const assignments = [];
  const context = fixture(({ operation, params }) => {
    if (operation === 'getDeployment') return { id: params.idOrUrl };
    if (operation === 'getProject') return { name: 'backend' };
    if (operation === 'getAlias') return { projectId: 'backend' };
    assert.equal(operation, 'assignAlias');
    assignments.push(params.requestBody.alias);
    return {};
  });
  const first = await context.providers.assignApplicationDeploymentFor({
    url: 'https://commit-a.vercel.app',
  });
  const second = await context.providers.assignApplicationDeploymentFor({
    url: 'https://commit-b.vercel.app',
  });
  assert.equal(first.url, second.url);
  assert.notEqual(first.id, second.id);
  assert.equal(assignments[0], assignments[1]);
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

test('frontend project settings retain their explicit Vercel config', async () => {
  const core = coreMock();
  const env = {
    VERCEL_LOCAL_CONFIG: 'frontend/vercel.json',
    DEPLOY_TARGET: 'preview',
    DEPLOY_BRANCH: 'branch',
  };
  const exec = {
    async getExecOutput(program, args) {
      assert.equal(program, 'vercel');
      assert.deepEqual(args, [
        'pull',
        '--yes',
        '--environment',
        'preview',
        '--git-branch',
        'branch',
        '--local-config',
        'frontend/vercel.json',
      ]);
      return { exitCode: 0, stdout: '', stderr: '' };
    },
  };
  await deploy.pull({ core, env, exec, providers: { sanitize: (text) => text } });
});

test('frontend packaging keeps CSR templates private and uses validated SSR/browser output', async (t) => {
  const directory = await temporary(t);
  const dist = path.join(directory, 'dist');
  await fs.mkdir(path.join(dist, 'server'), { recursive: true });
  await fs.mkdir(path.join(dist, 'browser'));
  await fs.writeFile(path.join(dist, 'server/server.mjs'), 'export default () => {};');
  await fs.writeFile(path.join(dist, 'browser/main.js'), 'compiled browser');
  await fs.writeFile(path.join(dist, 'browser/index.csr.html'), '<app-root></app-root>');
  const output = path.join(directory, 'output');
  await packageFrontend(dist, output);
  await assert.rejects(fs.access(path.join(output, 'static/index.csr.html')), { code: 'ENOENT' });
  await fs.access(path.join(output, 'functions/ssr.func/browser/index.csr.html'));
  assert.equal(await fs.readFile(path.join(output, 'static/main.js'), 'utf8'), 'compiled browser');
  assert.equal(
    JSON.parse(await fs.readFile(path.join(output, 'functions/ssr.func/.vc-config.json'))).handler,
    'server/server.mjs',
  );
});

test('publication binds private runtime configuration, not command-line secret values', async (t) => {
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
      DEPLOY_BRANCH: 'branch',
      DEPLOY_TARGET: 'preview',
      GITHUB_SHA: 'sha',
    };
    const providers = {
      ...createProviders({ core, env }),
      getApplicationRuntimeFor: async () => ({ DATABASE_URL: 'postgresql://private' }),
      assignApplicationDeploymentFor: async ({ url }) => {
        assert.equal(url, 'https://published.vercel.app');
        return { id: 'published', url };
      },
    };
    const exec = {
      async getExecOutput(program, args, options) {
        assert.equal(program, 'vercel');
        assert.ok(args.includes('--prebuilt') && args.includes('DATABASE_URL'));
        assert.ok(!args.includes('--local-config'));
        assert.ok(!args.join(' ').includes('postgresql://'));
        assert.equal(options.env.DATABASE_URL, 'postgresql://private');
        return {
          exitCode: 0,
          stdout: 'https://published.vercel.app\n',
          stderr: 'postgresql://private',
        };
      },
    };
    await deploy.publish({ core, env, exec, providers });
    const config = JSON.parse(await fs.readFile(path.join(fn, '.vc-config.json')));
    assert.equal(config.environment.DATABASE_URL, 'postgresql://private');
    assert.deepEqual(config.filePathMap, { 'app.py': 'backend/main.py' });
    assert.ok(!core.logs.join('\n').includes('postgresql://private'));
    assert.equal(core.outputs.deployment_id, 'published');
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
  assert.equal((action.match(/uses: \$\/\.github\/actions\/provider-script/g) ?? []).length, 2);
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
    assert.match(workflow, /DEPLOY_TARGET: \$\{\{ case\(/);
    assert.ok(!workflow.includes('concurrency:'));
    assert.ok(!workflow.includes("if: github.event_name == 'push'"));
    assert.ok(!/uses:.*reusable-(backend|frontend|database)/.test(workflow));
  }
  for (const caller of ['stack', 'backend', 'frontend', 'database']) {
    const workflow = await fs.readFile(path.join(root, `.github/workflows/${caller}.yml`), 'utf8');
    assert.match(workflow, /group: stack-\$\{\{ github.head_ref \|\| github.ref_name \}\}/);
  }
});
