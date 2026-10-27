const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const manifest = path.resolve(__dirname, '../actions/provider-script');

test('provider wrapper installs cold dependencies without credentials and reuses a ready cache', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'rns-sdk-cache-'),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const action = await fs.readFile(path.join(manifest, 'action.yml'), 'utf8');
  const script = action.match(/script: \|\n((?: {10}.+\n)+)/)[1].replace(/^ {10}/gm, '');
  const install = action.match(/run: \|\n((?: {8}.+\n)+)/)[1].replace(/^ {8}/gm, '');
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const previous = {
    SDK_MANIFEST: process.env.SDK_MANIFEST,
    RUNNER_TOOL_CACHE: process.env.RUNNER_TOOL_CACHE,
  };
  Object.assign(process.env, { SDK_MANIFEST: manifest, RUNNER_TOOL_CACHE: directory });
  try {
    const outputs = {};
    const core = {
      setOutput(key, value) {
        outputs[key] = value;
      },
    };
    const prepare = new AsyncFunction('require', 'core', script);
    await prepare(require, core);
    const hash = createHash('sha256')
      .update(await fs.readFile(path.join(manifest, 'package-lock.json')))
      .digest('hex');
    assert.equal(outputs.directory, path.join(directory, 'provider-sdk', hash));
    assert.ok(outputs.key.includes(`node${process.versions.node.split('.')[0]}-${hash}`));
    assert.equal(outputs.ready, false);

    const bin = path.join(directory, 'bin');
    await fs.mkdir(bin);
    await fs.writeFile(
      path.join(bin, 'npm'),
      '#!/usr/bin/env bash\nset -euo pipefail\nfor key in VERCEL_TOKEN NEON_API_KEY GH_TOKEN GITHUB_TOKEN DATABASE_URL; do [[ -z ${!key} ]]; done\nprintf "%s\\n" "$@" > "$NPM_ARGS"\nmkdir -p "$SDK_DIRECTORY/node_modules"\necho "{}" > "$SDK_DIRECTORY/node_modules/.package-lock.json"\n',
      { mode: 0o755 },
    );
    const stripped = Object.fromEntries(
      [
        ...action.matchAll(
          /^ {8}(VERCEL_TOKEN|NEON_API_KEY|GH_TOKEN|GITHUB_TOKEN|DATABASE_URL): ""$/gm,
        ),
      ].map(([, name]) => [name, '']),
    );
    assert.equal(Object.keys(stripped).length, 5);
    const env = {
      ...process.env,
      ...stripped,
      PATH: `${bin}:${process.env.PATH}`,
      SDK_DIRECTORY: outputs.directory,
      NPM_ARGS: path.join(directory, 'args'),
    };
    execFileSync('bash', ['-e', '-o', 'pipefail', '-c', install], { env });
    assert.equal(
      await fs.readFile(path.join(outputs.directory, 'package-lock.json'), 'utf8'),
      await fs.readFile(path.join(manifest, 'package-lock.json'), 'utf8'),
    );
    const args = (await fs.readFile(env.NPM_ARGS, 'utf8')).trim().split('\n');
    assert.ok(args.includes('--ignore-scripts') && args.includes('--omit=dev'));
    assert.ok(!action.includes('actions/checkout'));
    assert.match(action, /PROVIDER_DEPS_DIR: \$\{\{ steps.sdk.outputs.directory \}\}/);
    await prepare(require, core);
    assert.equal(outputs.ready, true);
    for (const output of ['url', 'deployment_id', 'branch_id', 'parent_branch_id'])
      assert.ok(action.includes(`steps.script.outputs.${output}`));
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
