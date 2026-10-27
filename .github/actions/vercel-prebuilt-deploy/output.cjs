const fs = require('node:fs/promises');
const path = require('node:path');

async function packageFrontend(dist, output) {
  // Angular was already compiled by validation. Vercel only needs its SSR
  // function, browser assets, and routing: https://vercel.com/docs/build-output-api
  const fn = path.join(output, 'functions/ssr.func');
  await fs.cp(dist, fn, { recursive: true });
  await fs.cp(path.join(dist, 'browser'), path.join(output, 'static'), {
    recursive: true,
    // The client-only index must not become Vercel's static homepage ahead of SSR.
    filter: (source) => path.basename(source) !== 'index.csr.html',
  });
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

async function bindRuntime(directory, runtime) {
  for (const name of await fs.readdir(directory)) {
    const filename = path.join(directory, name);
    if ((await fs.stat(filename)).isDirectory()) await bindRuntime(filename, runtime);
    else if (name === '.vc-config.json') {
      const config = JSON.parse(await fs.readFile(filename, 'utf8'));
      config.environment = { ...config.environment, ...runtime };
      await fs.writeFile(filename, JSON.stringify(config));
    }
  }
}

module.exports = { packageFrontend, bindRuntime };
