const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const actions = path.resolve(__dirname, '../actions');
const read = (file) => fs.readFile(path.join(actions, file), 'utf8');

test('setup-vercel-cli lets pnpm/setup install its own lockfile without a checkout', async () => {
  const manifest = JSON.parse(await read('setup-vercel-cli/package.json'));
  assert.deepEqual(manifest.dependencies, { vercel: '65.2.0' });
  assert.equal(manifest.packageManager, 'pnpm@12.15.0');
  const lockfile = await read('setup-vercel-cli/pnpm-lock.yaml');
  assert.ok(lockfile.includes('\n      vercel:\n        specifier: 65.2.0\n'));
  const text = await read('setup-vercel-cli/action.yml');
  assert.match(text, /uses: pnpm\/setup@v3\.1\.1/);
  assert.match(text, /working-directory: \$\{\{ github\.action_path \}\}/);
  // A derived `../` lockfile glob fails inside pnpm/setup for action snapshots outside the workspace.
  assert.match(text, /cache-dependency-path: \$\{\{ github\.action_path \}\}\/pnpm-lock\.yaml/);
  assert.match(text, /require-lockfile: true/);
  // pnpm/setup replaces its dest; a separate home preserves an application's pnpm store.
  assert.ok(text.includes('dest: ${{ runner.temp }}/vercel-cli-pnpm'));
  assert.ok(!/frontend|actions\/cache|actions\/checkout|\bnpm (?:ci|install)\b/.test(text));
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
