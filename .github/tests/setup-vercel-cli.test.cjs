const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const action = path.resolve(__dirname, '../actions/setup-vercel-cli');
const read = (file) => fs.readFile(path.join(action, file), 'utf8');

async function inlineRuns() {
  return [...(await read('action.yml')).matchAll(/run: \|\n((?: {8}.+\n)+)/g)].map((match) =>
    match[1].replace(/^ {8}/gm, ''),
  );
}

test('the Vercel CLI installs from its npm lockfile on the runner Node.js, without pnpm or a checkout', async () => {
  assert.deepEqual(JSON.parse(await read('package.json')), {
    name: 'rent-n-sail-vercel-cli',
    private: true,
    dependencies: { vercel: '65.2.0' },
  });
  const { packages } = JSON.parse(await read('package-lock.json'));
  assert.equal(packages['node_modules/vercel'].version, '65.2.0');
  for (const [name, entry] of Object.entries(packages)) {
    if (!name) continue;
    assert.match(entry.resolved, /^https:\/\/registry\.npmjs\.org\//, name);
    assert.ok(entry.integrity, name);
  }
  assert.ok(!(await fs.readdir(action)).some((file) => file.startsWith('pnpm-')));
  const steps = (await read('action.yml')).replace(/^\s*#.*\n/gm, '');
  assert.ok(!/pnpm|setup-node|actions\/checkout|frontend/.test(steps));
});

test('the installed CLI is cached under a fixed path, keyed by this action and its lockfile', async (t) => {
  const [locate, install] = await inlineRuns();
  const directory = await fs.mkdtemp(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'rns-cli-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const env = {
    ...process.env,
    GITHUB_ACTION_PATH: action,
    RUNNER_TEMP: '/runner-temp',
    RUNNER_OS: 'Linux',
    RUNNER_ARCH: 'X64',
    GITHUB_PATH: path.join(directory, 'path'),
    GITHUB_OUTPUT: path.join(directory, 'output'),
  };
  execFileSync('bash', ['-e', '-o', 'pipefail', '-c', locate], { env });
  assert.equal(
    await fs.readFile(env.GITHUB_PATH, 'utf8'),
    '/runner-temp/vercel-cli/node_modules/.bin\n',
  );
  const digest = createHash('sha256')
    .update(await read('action.yml'))
    .update(await read('package-lock.json'))
    .digest('hex');
  assert.equal(
    await fs.readFile(env.GITHUB_OUTPUT, 'utf8'),
    `cache-key=vercel-cli-Linux-X64-${digest}\n`,
  );
  const text = await read('action.yml');
  assert.ok(text.includes('path: ${{ runner.temp }}/vercel-cli\n'));
  assert.ok(text.includes("if: steps.cache.outputs.cache-hit != 'true'"));
  // Linux runs the JavaScript CLI, so platform binaries and their install scripts are skipped.
  assert.match(
    install,
    /npm ci --prefix "\$RUNNER_TEMP\/vercel-cli" --omit=optional --ignore-scripts /,
  );
});
