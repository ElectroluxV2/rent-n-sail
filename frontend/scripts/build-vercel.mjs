import { spawnSync } from 'node:child_process';
import { access, cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const frontend = fileURLToPath(new URL('../', import.meta.url));
if (process.env['RNS_FRONTEND_BUILD_READY'] === 'true') {
  // The reusable workflow already validated this checkout's production build.
  await access(join(frontend, 'dist/frontend/server/server.mjs'));
  await access(join(frontend, 'dist/frontend/browser'));
} else {
  const build = spawnSync(
    process.execPath,
    [join(frontend, 'node_modules/@angular/cli/bin/ng.js'), 'build'],
    { cwd: frontend, stdio: 'inherit' },
  );
  if (build.error) throw build.error;
  if (build.status !== 0) process.exit(build.status ?? 1);
}

// https://vercel.com/docs/build-output-api
const output = join(frontend, '.vercel/output');
const ssr = join(output, 'functions/ssr.func');
const dist = join(frontend, 'dist/frontend');
await rm(output, { recursive: true, force: true });
await mkdir(ssr, { recursive: true });
await cp(dist, ssr, { recursive: true });
await cp(join(dist, 'browser'), join(output, 'static'), { recursive: true });
await writeFile(
  join(ssr, '.vc-config.json'),
  JSON.stringify({
    runtime: `nodejs${process.versions.node.split('.')[0]}.x`,
    handler: 'server/server.mjs',
    launcherType: 'Nodejs',
    supportsResponseStreaming: true,
  }),
);
await writeFile(
  join(output, 'config.json'),
  JSON.stringify({
    version: 3,
    routes: [{ handle: 'filesystem' }, { src: '/(.*)', dest: '/ssr' }],
  }),
);
