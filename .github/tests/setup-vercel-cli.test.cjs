const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const action = path.resolve(__dirname, '../actions/setup-vercel-cli');
const read = (file) => fs.readFile(path.join(action, file), 'utf8');

test('pnpm/setup installs the locked Vercel CLI from this action, without a checkout or Node.js download', async () => {
  assert.deepEqual(JSON.parse(await read('package.json')), {
    name: 'rent-n-sail-vercel-cli',
    private: true,
    dependencies: { vercel: '65.2.0' },
    packageManager: 'pnpm@12.15.0',
  });
  const lockfile = await read('pnpm-lock.yaml');
  assert.ok(lockfile.includes('\n      vercel:\n        specifier: 65.2.0\n'));
  assert.ok(!lockfile.includes('node@runtime'));
  // Linux runs the JavaScript CLI: no optional platform binaries, install scripts, or registry re-verification.
  assert.equal(
    await read('pnpm-workspace.yaml'),
    'allowBuilds:\n  esbuild: false\noptional: false\ntrustLockfile: true\n',
  );
  const text = await read('action.yml');
  assert.match(text, /uses: pnpm\/setup@v3\.1\.1/);
  assert.match(text, /working-directory: \$\{\{ github\.action_path \}\}/);
  // A derived `../` lockfile glob fails inside pnpm/setup for action snapshots outside the workspace.
  assert.match(text, /cache-dependency-path: \$\{\{ github\.action_path \}\}\/pnpm-lock\.yaml/);
  assert.match(text, /require-lockfile: true/);
  // pnpm/setup replaces its dest; a separate home preserves an application's pnpm store and runtime.
  assert.ok(text.includes('dest: ${{ runner.temp }}/vercel-cli-pnpm'));
  const steps = text.replace(/^\s*#.*\n/gm, '');
  assert.ok(
    !/frontend|runtime|actions\/cache|actions\/checkout|\bnpm (?:ci|install)\b/.test(steps),
  );
});

test('the installed Vercel CLI is added to PATH', async (t) => {
  const script = (await read('action.yml')).match(/run: (.+)\n/)[1];
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
