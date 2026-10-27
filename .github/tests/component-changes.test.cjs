const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const script = path.join(root, '.github/actions/component-changes/detect.sh');

test('bare Git detector compares complete commit trees without a worktree', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'rns-diff-'),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const work = path.join(directory, 'work');
  await fs.mkdir(path.join(work, 'backend'), { recursive: true });
  await fs.mkdir(path.join(work, 'frontend'));
  const git = (...args) => execFileSync('git', ['-C', work, ...args], { encoding: 'utf8' }).trim();
  git('init', '--quiet');
  git('config', 'user.name', 'CI fixture');
  git('config', 'user.email', 'ci@example.invalid');
  await fs.writeFile(path.join(work, 'backend/main.py'), 'application');
  git('add', '.');
  git('commit', '--quiet', '-m', 'before');
  const before = git('rev-parse', 'HEAD');
  await fs.rename(path.join(work, 'backend/main.py'), path.join(work, 'frontend/moved.py'));
  await fs.writeFile(path.join(work, 'frontend/line\nbreak.ts'), 'newline');
  git('add', '-A');
  git('commit', '--quiet', '-m', 'rename');
  const renamed = git('rev-parse', 'HEAD');
  await Promise.all(
    Array.from({ length: 301 }, (_, i) =>
      fs.writeFile(path.join(work, `frontend/${i}.ts`), 'large diff'),
    ),
  );
  git('add', '.');
  git('commit', '--quiet', '-m', 'large frontend-only push');
  const after = git('rev-parse', 'HEAD');
  const origin = path.join(directory, 'server/owner/repo.git');
  await fs.mkdir(path.dirname(origin), { recursive: true });
  git('clone', '--bare', '--quiet', work, origin);
  execFileSync('git', ['--git-dir', origin, 'config', 'uploadpack.allowFilter', 'true']);

  for (const [name, old, next, searched, changed] of [
    ['rename source', before, renamed, 'backend/', true],
    ['rename destination', before, renamed, 'frontend/', true],
    ['newline path', before, renamed, 'line\nbreak', true],
    ['arbitrary substring', before, renamed, 'end/mov', true],
    ['empty diff', after, after, 'backend/', false],
    ['large unrelated diff', renamed, after, 'backend/', false],
    ['file beyond the API cap', renamed, after, 'frontend/300.ts', true],
  ])
    await t.test(name, async () => {
      const output = path.join(directory, 'output');
      await fs.writeFile(output, '');
      const result = spawnSync('bash', [script], {
        encoding: 'utf8',
        env: {
          ...process.env,
          RUNNER_TEMP: directory,
          GITHUB_SERVER_URL: `file://${path.join(directory, 'server')}`,
          GITHUB_REPOSITORY: 'owner/repo',
          GITHUB_OUTPUT: output,
          GH_TOKEN: 'fixture-token',
          BEFORE: old,
          AFTER: next,
          CHECK_PATH: searched,
        },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(await fs.readFile(output, 'utf8'), `changed=${changed}\n`);
      assert.match(result.stdout, /\u001b\[/);
      assert.ok(result.stdout.includes(`Searched path: ${JSON.stringify(searched)}`));
      assert.ok(!(await fs.readdir(directory)).some((name) => name.startsWith('changed-path.')));
    });
});

test('short inline CLI setup uses native tool versions and cached installation arguments', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'rns-setup-'),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const bin = path.join(directory, 'bin');
  await fs.mkdir(bin);
  await fs.writeFile(path.join(bin, 'node'), '#!/usr/bin/env bash\necho v24.fixture\n', {
    mode: 0o755,
  });
  await fs.writeFile(path.join(bin, 'vercel'), '#!/usr/bin/env bash\necho vercel.fixture\n', {
    mode: 0o755,
  });
  await fs.writeFile(
    path.join(bin, 'pnpm'),
    '#!/usr/bin/env bash\nif [[ $1 == --version ]]; then echo 12.fixture; else printf "%s\\n" "$@" > "$CAPTURE"; fi\n',
    { mode: 0o755 },
  );
  const action = await fs.readFile(
    path.join(root, '.github/actions/setup-vercel-cli/action.yml'),
    'utf8',
  );
  const scripts = [...action.matchAll(/run: \|\n((?: {8}.+\n)+)/g)].map((match) =>
    match[1].replace(/^ {8}/gm, ''),
  );
  assert.equal(scripts.length, 2);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    RUNNER_TOOL_CACHE: path.join(directory, 'tools'),
    RUNNER_TEMP: directory,
    GITHUB_OUTPUT: path.join(directory, 'output'),
    GITHUB_PATH: path.join(directory, 'path'),
    VERCEL_CLI_VERSION: '65.2.0',
    CAPTURE: path.join(directory, 'args'),
  };
  for (const script of scripts)
    execFileSync('bash', ['-e', '-o', 'pipefail', '-c', script], { env });
  assert.equal(
    await fs.readFile(env.GITHUB_OUTPUT, 'utf8'),
    'node-version=v24.fixture\npnpm-version=12.fixture\n',
  );
  assert.equal(
    await fs.readFile(env.GITHUB_PATH, 'utf8'),
    `${env.RUNNER_TOOL_CACHE}/vercel-cli/node_modules/.bin\n`,
  );
  const args = (await fs.readFile(env.CAPTURE, 'utf8')).trim().split('\n');
  assert.ok(args.includes('--config.virtual-store-type=project') && args.includes('vercel@65.2.0'));
});
