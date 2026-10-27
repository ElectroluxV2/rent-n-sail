const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const actions = path.resolve(__dirname, '../actions');
const read = (file) => fs.readFile(path.join(actions, file), 'utf8');

for (const [action, dest, dependencies] of [
  ['provider-script', 'provider-script-pnpm', { '@neon/sdk': '7.5.0', '@vercel/sdk': '1.28.51' }],
  ['setup-vercel-cli', 'vercel-cli-pnpm', { vercel: '65.2.0' }],
])
  test(`${action} lets pnpm/setup install its own lockfile without a checkout`, async () => {
    const manifest = JSON.parse(await read(`${action}/package.json`));
    assert.deepEqual(manifest.dependencies, dependencies);
    assert.equal(manifest.packageManager, 'pnpm@12.15.0');
    const lockfile = await read(`${action}/pnpm-lock.yaml`);
    for (const [name, version] of Object.entries(dependencies)) {
      const key = name.startsWith('@') ? `'${name}'` : name;
      assert.ok(lockfile.includes(`\n      ${key}:\n        specifier: ${version}\n`), name);
    }
    const text = await read(`${action}/action.yml`);
    assert.match(text, /uses: pnpm\/setup@v3\.1\.1/);
    assert.match(text, /working-directory: \$\{\{ github\.action_path \}\}/);
    assert.match(text, /require-lockfile: true/);
    // pnpm/setup replaces its dest; a separate home preserves an application's pnpm store.
    assert.ok(text.includes(`dest: \${{ runner.temp }}/${dest}`));
    assert.ok(!/frontend|actions\/cache|actions\/checkout|\bnpm (?:ci|install)\b/.test(text));
  });

test('provider scripts install SDKs without credentials, then run the requested script', async () => {
  const text = await read('provider-script/action.yml');
  const [setup, script] = text.split('    - name: ').slice(1);
  for (const name of ['VERCEL_TOKEN', 'NEON_API_KEY', 'GH_TOKEN', 'GITHUB_TOKEN', 'DATABASE_URL'])
    assert.ok(setup.includes(`        ${name}: ""\n`), name);
  assert.match(script, /uses: actions\/github-script@v9\.0\.0/);
  assert.match(script, /script: \$\{\{ inputs\.script \}\}/);
  for (const output of ['url', 'deployment_id', 'branch_id', 'parent_branch_id'])
    assert.ok(text.includes(`value: \${{ steps.script.outputs.${output} }}`), output);
  assert.equal(JSON.parse(await read('provider-script/package.json')).devEngines, undefined);
});

test('Vercel CLI setup pins Node and its allowed build script, then exposes the CLI', async (t) => {
  const manifest = JSON.parse(await read('setup-vercel-cli/package.json'));
  assert.deepEqual(manifest.devEngines.runtime, {
    name: 'node',
    version: '24',
    onFail: 'download',
  });
  assert.equal(
    await read('setup-vercel-cli/pnpm-workspace.yaml'),
    'allowBuilds:\n  esbuild: true\n',
  );
  const text = await read('setup-vercel-cli/action.yml');
  const script = text.match(/run: (.+)\n/)[1];
  const directory = await fs.mkdtemp(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'rns-cli-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const env = {
    ...process.env,
    GITHUB_ACTION_PATH: '/action',
    GITHUB_PATH: path.join(directory, 'path'),
  };
  execFileSync('bash', ['-e', '-o', 'pipefail', '-c', script], { env });
  assert.equal(await fs.readFile(env.GITHUB_PATH, 'utf8'), '/action/node_modules/.bin\n');
});
