const { createProviders } = require('../_shared/providers.cjs');
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

async function vercel({ exec, env }, args, bindings = env) {
  if (env.VERCEL_LOCAL_CONFIG) args.push('--local-config', env.VERCEL_LOCAL_CONFIG);
  const { stdout } = await exec.getExecOutput('vercel', args, { env: bindings });
  return stdout.trim();
}

async function reuse(context) {
  await report(context, 'reuse', await context.providers.getServiceDeploymentFor());
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
  } else await vercel(context, ['build', '--environment', env.DEPLOY_TARGET]);
}

async function publish(context) {
  const { env, providers } = context;
  const runtime =
    env.COMPONENT === 'frontend'
      ? await providers.getFrontendServiceRuntime()
      : await providers.getBackendServiceRuntime();
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
  await report(context, 'build', await providers.assignServiceDeploymentFor(url));
}

module.exports = async ({ core, exec, env = process.env }) => {
  const providers = createProviders({ core, env });
  try {
    await { reuse, pull, build, publish }[env.DEPLOY_OPERATION]({ core, exec, env, providers });
  } catch (error) {
    await core.summary
      .addHeading(`${env.COMPONENT} deployment failed`)
      .addRaw(`${env.DEPLOY_OPERATION}: ${error.message}`, true)
      .write();
    throw error;
  }
};
