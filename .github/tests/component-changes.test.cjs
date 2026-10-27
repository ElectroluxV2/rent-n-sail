const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');

async function inlineRuns(action) {
  const text = await fs.readFile(path.join(root, `.github/actions/${action}/action.yml`), 'utf8');
  return [...text.matchAll(/run: \|\n((?: {8}.+\n)+)/g)].map((match) =>
    match[1].replace(/^ {8}/gm, ''),
  );
}

test('bare Git detector compares complete commit trees without a worktree', async (t) => {
  const [script] = await inlineRuns('component-changes');
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
  const runnerTemp = path.join(directory, 'runner');
  await fs.mkdir(runnerTemp);

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
      // GitHub runs `shell: bash` steps with `-e -o pipefail`.
      const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
        encoding: 'utf8',
        env: {
          ...process.env,
          RUNNER_TEMP: runnerTemp,
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
      assert.deepEqual(await fs.readdir(runnerTemp), ['changes.git']);
      assert.equal(
        execFileSync(
          'git',
          ['--git-dir', path.join(runnerTemp, 'changes.git'), 'rev-parse', '--is-bare-repository'],
          {
            encoding: 'utf8',
          },
        ).trim(),
        'true',
      );
    });
});

test('Git authentication is masked and passed through the environment', async () => {
  const [script] = await inlineRuns('component-changes');
  assert.match(script, /base64 -w0\)/);
  assert.ok(!script.includes('| tr'));
  assert.match(script, /::add-mask::/);
  assert.ok(!/fetch[^\n]*(GH_TOKEN|x-access-token)/.test(script));
});
