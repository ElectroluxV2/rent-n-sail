const fs = require('node:fs/promises');
const path = require('node:path');
const { command } = require('../_shared/commands.cjs');

const VERSION = 2;
const HINTS = new Set([
  'PYTHONPATH',
  'PYTHONHOME',
  'PYTHONUNBUFFERED',
  'NODE_ENV',
  'TZ',
  'LANG',
  'LC_ALL',
]);
const inside = (filename, root) => filename === root || filename.startsWith(`${root}${path.sep}`);

async function canonical(filename) {
  const absolute = path.resolve(filename);
  try {
    return await fs.realpath(absolute);
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Invalid or cyclic build-output path.');
    const parent = path.dirname(absolute);
    if (parent === absolute) throw error;
    return path.join(await canonical(parent), path.basename(absolute));
  }
}

async function checkDestination(destination, temporary) {
  const roots = await Promise.all(
    [process.env.GITHUB_WORKSPACE || process.cwd(), temporary].filter(Boolean).map(canonical),
  );
  const target = await canonical(destination);
  if (!roots.some((root) => target !== root && inside(target, root)))
    throw new Error('Unsafe output destination.');
}

async function packageFrontend({ dist, output, temporary }) {
  await checkDestination(output, temporary);
  await fs.access(path.join(dist, 'server/server.mjs'));
  await fs.access(path.join(dist, 'browser'));
  // Angular has already compiled SSR and browser assets in the validation job.
  // Describe that output directly: no second build or Vercel api/* discovery stub.
  // https://vercel.com/docs/build-output-api
  await fs.rm(output, { recursive: true, force: true });
  const fn = path.join(output, 'functions/ssr.func');
  await fs.cp(dist, fn, { recursive: true });
  await fs.cp(path.join(dist, 'browser'), path.join(output, 'static'), { recursive: true });
  await fs.writeFile(
    path.join(fn, '.vc-config.json'),
    JSON.stringify({
      runtime: `nodejs${process.versions.node.split('.')[0]}.x`,
      handler: 'server/server.mjs',
      launcherType: 'Nodejs',
      supportsResponseStreaming: true,
    }),
  );
  await fs.writeFile(
    path.join(output, 'config.json'),
    JSON.stringify({
      version: 3,
      routes: [{ handle: 'filesystem' }, { src: '/(.*)', dest: '/ssr' }],
    }),
  );
}

async function portableCopy(source, destination, workspace, ancestors = new Set()) {
  const resolved = await canonical(source);
  if (!inside(resolved, workspace) || ancestors.has(resolved))
    throw new Error('Build output contains an external symlink or cycle.');
  if (path.basename(source).startsWith('.env')) return;
  const stat = await fs.stat(source);
  if (stat.isDirectory()) {
    await fs.mkdir(destination, { recursive: true });
    const parents = new Set([...ancestors, resolved]);
    for (const child of await fs.readdir(source)) {
      await portableCopy(
        path.join(source, child),
        path.join(destination, child),
        workspace,
        parents,
      );
    }
  } else {
    if (!stat.isFile()) throw new Error('Unsupported build-output file.');
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
    await fs.chmod(destination, stat.mode & 0o777);
  }
}

async function files(directory, workspace, ancestors = new Set()) {
  if (!inside(await canonical(directory), workspace))
    throw new Error('Build output escapes the checkout.');
  const resolved = await canonical(directory);
  if (ancestors.has(resolved)) throw new Error('Build output contains a symlink cycle.');
  const stat = await fs.stat(directory);
  if (!stat.isDirectory()) return [directory];
  const result = [];
  for (const child of await fs.readdir(directory)) {
    result.push(
      ...(await files(path.join(directory, child), workspace, new Set([...ancestors, resolved]))),
    );
  }
  return result;
}

async function materialize(output, workspace) {
  const directory = path.join(output, 'functions');
  if (!(await fs.stat(directory).catch(() => null))) return;
  for (const filename of await files(directory, workspace)) {
    if (path.basename(filename) !== '.vc-config.json') continue;
    const root = await canonical(path.dirname(filename));
    if (!inside(await canonical(filename), root))
      throw new Error('Function metadata escapes the function.');
    const config = JSON.parse(await fs.readFile(filename, 'utf8'));
    for (const [relative, original] of Object.entries(config.filePathMap ?? {})) {
      if (
        !relative ||
        path.isAbsolute(relative) ||
        relative.includes('\\') ||
        relative.split('/').some((part) => part === '..' || part === '.')
      ) {
        throw new Error('Unsafe mapped function destination.');
      }
      if (
        relative
          .split('/')
          .some(
            (part) =>
              part.startsWith('.env') ||
              ['__pycache__', '.pytest_cache', '.ruff_cache'].includes(part),
          )
      )
        continue;
      if (typeof original !== 'string') throw new Error('Invalid mapped function source.');
      const source = await canonical(path.resolve(workspace, original));
      const destination = await canonical(path.join(root, relative));
      if (
        !inside(source, workspace) ||
        !inside(destination, root) ||
        !(await fs.stat(source)).isFile()
      ) {
        throw new Error('Function mappings must be checkout-local files.');
      }
      if (source !== destination) await portableCopy(source, destination, workspace);
    }
    delete config.filePathMap;
    await fs.writeFile(filename, JSON.stringify(config));
  }
}

async function packOutput({
  source,
  archive,
  component,
  workspace = source,
  temporary,
  exec,
  secrets = [],
}) {
  source = path.resolve(source);
  workspace = await canonical(workspace);
  if (!inside(await canonical(source), workspace))
    throw new Error('Build output escapes the checkout.');
  const config = JSON.parse(await fs.readFile(path.join(source, 'config.json'), 'utf8'));
  if (config.version !== 3 || config.services || config.daemons)
    throw new Error('Unsupported portable Build Output configuration.');
  await materialize(source, workspace);
  const stage = await fs.realpath(await fs.mkdtemp(path.join(temporary, 'pack-')));
  const output = path.join(stage, 'output');
  await fs.mkdir(output);
  for (const name of ['config.json', 'functions', 'static']) {
    if (await fs.stat(path.join(source, name)).catch(() => null)) {
      await portableCopy(path.join(source, name), path.join(output, name), workspace);
    }
  }
  const entries = await files(output, output);
  for (const filename of entries) {
    if (path.basename(filename) !== '.vc-config.json') continue;
    const metadata = JSON.parse(await fs.readFile(filename, 'utf8'));
    metadata.environment = Object.fromEntries(
      Object.entries(metadata.environment ?? {}).filter(([key]) => HINTS.has(key)),
    );
    await fs.writeFile(filename, JSON.stringify(metadata));
  }
  const needles = secrets.filter(Boolean).map((value) => Buffer.from(value));
  for (const filename of entries) {
    const content = await fs.readFile(filename);
    if (needles.some((needle) => content.includes(needle)))
      throw new Error('Credential found in build output; refusing upload.');
  }
  await fs.writeFile(
    path.join(stage, 'manifest.json'),
    JSON.stringify({ version: VERSION, component }),
  );
  await fs.mkdir(path.dirname(archive), { recursive: true });
  await command(exec, 'tar', ['-czf', archive, '-C', stage, 'output', 'manifest.json']);
}

async function restoreOutput({ archive, destination, component, temporary, exec }) {
  const names = (await command(exec, 'tar', ['-tzf', archive])).stdout.trim().split('\n');
  for (const name of names) {
    if (
      !(
        name === 'output' ||
        name === 'output/' ||
        name.startsWith('output/') ||
        name === 'manifest.json'
      ) ||
      name.includes('\\') ||
      name.split('/').some((part) => part === '..' || part === '.')
    ) {
      throw new Error('Unsafe archive member or traversal.');
    }
  }
  const bsd = (await command(exec, 'tar', ['--version'])).stdout.includes('bsdtar');
  const listing = (await command(exec, 'tar', ['-tvzf', archive, '--numeric-owner'])).stdout
    .trim()
    .split('\n');
  let total = 0;
  for (const line of listing) {
    const fields = line.trim().split(/\s+/);
    const size = Number(fields[bsd ? 4 : 2]);
    if (!['-', 'd'].includes(line[0]) || !Number.isSafeInteger(size) || size < 0)
      throw new Error('Archive contains links or special files.');
    total += size;
  }
  if (total > 2 * 1024 ** 3) throw new Error('Expanded build output exceeds the size limit.');
  const stage = await fs.mkdtemp(path.join(temporary, 'restore-'));
  await command(exec, 'tar', [
    '-xzf',
    archive,
    '-C',
    stage,
    '--no-same-owner',
    '--no-same-permissions',
  ]);
  const manifest = JSON.parse(await fs.readFile(path.join(stage, 'manifest.json'), 'utf8'));
  if (
    manifest.version !== VERSION ||
    manifest.component !== component ||
    Object.keys(manifest).length !== 2
  )
    throw new Error('Incompatible build output artifact.');
  await checkDestination(destination, temporary);
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(path.join(stage, 'output'), destination, { recursive: true });
}

async function injectRuntime(output, runtime, workspace = process.env.GITHUB_WORKSPACE ?? output) {
  let count = 0;
  for (const filename of await files(path.join(output, 'functions'), await canonical(workspace))) {
    if (path.basename(filename) !== '.vc-config.json') continue;
    const config = JSON.parse(await fs.readFile(filename, 'utf8'));
    config.environment = { ...config.environment, ...runtime };
    await fs.writeFile(filename, JSON.stringify(config));
    count++;
  }
  if (!count) throw new Error('No runtime function configuration was found.');
}

module.exports = {
  VERSION,
  canonical,
  packageFrontend,
  inside,
  portableCopy,
  materialize,
  packOutput,
  restoreOutput,
  injectRuntime,
};
