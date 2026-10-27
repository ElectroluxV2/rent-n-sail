const fs = require('node:fs/promises');
const path = require('node:path');
const { command, commandEnvironment } = require('../_shared/commands.cjs');

module.exports = async ({ core, exec }) => {
  const directory = path.join(process.env.RUNNER_TOOL_CACHE, 'vercel-cli');
  const env = commandEnvironment();
  for (const name of ['VERCEL_TOKEN', 'NEON_API_KEY', 'GITHUB_TOKEN', 'GH_TOKEN', 'DATABASE_URL'])
    delete env[name];
  if (process.env.CLI_OPERATION === 'prepare') {
    core.setOutput(
      'node-version',
      (await command(exec, 'node', ['--version'], { env })).stdout.trim(),
    );
    core.setOutput(
      'pnpm-version',
      (await command(exec, 'pnpm', ['--version'], { env })).stdout.trim(),
    );
    core.addPath(path.join(directory, 'node_modules/.bin'));
  } else if (process.env.CLI_OPERATION === 'install') {
    await fs.mkdir(directory, { recursive: true });
    await command(
      exec,
      'pnpm',
      [
        '--dir',
        directory,
        'add',
        '--save-exact',
        '--allow-build=esbuild',
        '--store-dir',
        path.join(process.env.RUNNER_TEMP, 'vercel-cli-store'),
        '--config.virtual-store-type=project',
        `vercel@${process.env.VERCEL_CLI_VERSION}`,
      ],
      { env },
    );
    core.info((await command(exec, 'vercel', ['--version'], { env })).stdout);
  } else throw new Error('Unknown CLI setup operation.');
};
