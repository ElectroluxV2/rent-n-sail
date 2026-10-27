const fs = require('node:fs/promises');
const path = require('node:path');
const { createProviders } = require('../provider-script/providers.cjs');
const { command, buildEnvironment } = require('../_shared/commands.cjs');
const { packageFrontend, bindRuntime } = require('./output.cjs');

async function report({ core, env }, mode, { id, url }) {
  core.info(`${env.COMPONENT}: ${mode} deployment ${id} at ${url}.`);
  core.setOutput('url', url);
  core.setOutput('deployment_id', id);
  await core.summary
    .addHeading(`${env.COMPONENT} deployment`)
    .addRaw(
      `\n- Target: ${env.DEPLOY_TARGET}\n- Mode: ${mode}\n- Deployment: ${id}\n- URL: <${url}>\n`,
      true,
    )
    .write();
}

async function vercel({ core, exec, env, providers }, args, bindings = env) {
  if (env.VERCEL_LOCAL_CONFIG) args.push('--local-config', env.VERCEL_LOCAL_CONFIG);
  const result = await command(exec, 'vercel', args, { env: bindings, allowFailure: true });
  core.info(providers.sanitize(result.stdout));
  core.info(providers.sanitize(result.stderr));
  if (result.exitCode) throw new Error(`Vercel ${args[0]} failed; see sanitized CLI output.`);
  return result.stdout.trim();
}

async function reuse(context) {
  await report(context, 'reuse', await context.providers.getApplicationDeploymentFor());
}

async function pull(context) {
  const { env } = context;
  const args = ['pull', '--yes', '--environment', env.DEPLOY_TARGET];
  if (env.DEPLOY_TARGET === 'preview') args.push('--git-branch', env.DEPLOY_BRANCH);
  await vercel(context, args);
}

async function build(context) {
  const { core, env } = context;
  if (env.COMPONENT === 'frontend') {
    await packageFrontend('frontend/dist/frontend', '.vercel/output');
    core.info('Packaged the validated Angular SSR build; no second build.');
  } else {
    // Bind private configuration at publication, never during compilation.
    for (const name of await fs.readdir('.vercel')) {
      if (name.startsWith('.env.')) await fs.writeFile(path.join('.vercel', name), '');
    }
    await vercel(context, ['build', '--environment', env.DEPLOY_TARGET], buildEnvironment(env));
  }
}

async function publish(context) {
  const { env, providers } = context;
  const runtime = await providers.getApplicationRuntimeFor({ application: env.COMPONENT });
  await bindRuntime('.vercel/output/functions', runtime);
  const args = [
    'deploy',
    '--prebuilt',
    '--environment',
    env.DEPLOY_TARGET,
    '--meta',
    'githubDeployment=1',
    '--meta',
    `githubCommitRef=${env.DEPLOY_BRANCH}`,
    '--meta',
    `githubCommitSha=${env.GITHUB_SHA}`,
  ];
  for (const key of Object.keys(runtime)) args.push('--env', key);
  const url = await vercel(context, args, { ...env, ...runtime });
  // The CLI waits for READY; the provider owns ID lookup and stable-URL assignment.
  await report(context, 'build', await providers.assignApplicationDeploymentFor({ url }));
}

module.exports = async ({ core, exec, env = process.env }) => {
  const providers = createProviders({ core, env });
  await { reuse, pull, build, publish }[env.DEPLOY_OPERATION]({ core, exec, env, providers });
};
Object.assign(module.exports, { reuse, pull, build, publish });
