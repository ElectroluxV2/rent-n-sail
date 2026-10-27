const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const shared = path.resolve(__dirname, '../actions/_shared');
const vendor = path.join(shared, 'vendor');
const read = (file) => fs.readFile(path.join(vendor, file), 'utf8');

async function temporary(t, prefix) {
  const directory = await fs.mkdtemp(path.join(process.env.RUNNER_TEMP || os.tmpdir(), prefix));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('the checked-in SDK bundle and notices match a rebuild from the lockfile', async (t) => {
  await fs.access(path.join(vendor, 'node_modules/esbuild')).catch(() => {
    throw new Error(
      'Run `pnpm --dir .github/actions/_shared/vendor install --frozen-lockfile` first.',
    );
  });
  const output = await temporary(t, 'rns-sdk-build-');
  execFileSync(process.execPath, [path.join(vendor, 'src/build.mjs'), output]);
  for (const file of ['sdk.cjs', 'THIRD_PARTY_NOTICES.txt'])
    assert.equal(
      await fs.readFile(path.join(output, file), 'utf8'),
      await read(file),
      `${file} is stale`,
    );
});

test('the SDK bundle pins exact versions and ships every bundled license', async () => {
  const manifest = JSON.parse(await read('package.json'));
  assert.deepEqual(manifest.dependencies, { '@neon/sdk': '7.5.0', '@vercel/sdk': '1.28.51' });
  assert.deepEqual(manifest.devDependencies, { esbuild: '0.28.2' });
  const lockfile = await read('pnpm-lock.yaml');
  for (const [name, version] of Object.entries({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  }))
    assert.ok(
      lockfile.includes(
        `\n      ${name.startsWith('@') ? `'${name}'` : name}:\n        specifier: ${version}\n`,
      ),
      name,
    );
  const notices = await read('THIRD_PARTY_NOTICES.txt');
  assert.deepEqual(notices.match(/^\S+@\d\S* \(.+\)$/gm), [
    '@neon/sdk@7.5.0 (Apache-2.0)',
    '@vercel/sdk@1.28.51 (Apache-2.0)',
    'zod@4.6.7 (MIT)',
  ]);
  assert.match(notices, /Apache License\s+Version 2\.0/);
  assert.match(notices, /MIT License/);
});

test('provider helpers run from the bundle alone, without node_modules or installation', async (t) => {
  const directory = await temporary(t, 'rns-sdk-runtime-');
  await fs.mkdir(path.join(directory, 'vendor'));
  await fs.copyFile(path.join(shared, 'providers.cjs'), path.join(directory, 'providers.cjs'));
  await fs.copyFile(path.join(vendor, 'sdk.cjs'), path.join(directory, 'vendor/sdk.cjs'));
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (input) => {
    calls.push(new URL(input.url ?? input).hostname);
    return Response.json(
      { error: { code: 'forbidden', message: 'postgresql://private' } },
      { status: 403 },
    );
  });
  const { createProviders } = require(path.join(directory, 'providers.cjs'));
  const core = { info() {}, setSecret() {} };
  const providers = createProviders({
    core,
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
    /^Error: vercel request failed \(HTTP 403\)\.$/,
  );
  await assert.rejects(
    providers.getProductionDatabase(),
    /^Error: neon request failed \(HTTP 403\)\.$/,
  );
  assert.deepEqual(calls, ['api.vercel.com', 'console.neon.tech']);
});

test('provider steps call github-script directly, without installing anything', async () => {
  for (const action of ['neon-operation', 'vercel-prebuilt-deploy']) {
    const text = await fs.readFile(path.join(shared, `../${action}/action.yml`), 'utf8');
    assert.ok(!/provider-script|pnpm\/setup|\bnpm (?:ci|install)\b/.test(text), action);
  }
  const neon = await fs.readFile(path.join(shared, '../neon-operation/action.yml'), 'utf8');
  assert.match(neon, /uses: actions\/github-script@v9\.0\.0/);
  assert.match(
    neon,
    /PROVIDERS_MODULE: \$\{\{ github\.action_path \}\}\/\.\.\/_shared\/providers\.cjs/,
  );
});
