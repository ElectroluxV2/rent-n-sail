const { createProviders } = require('../_shared/providers.cjs');
const { packageFrontend } = require('./output.cjs');

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

async function runtimeFor({ env, providers }) {
  return env.COMPONENT === 'frontend'
    ? providers.getFrontendServiceRuntime()
    : providers.getBackendServiceRuntime();
}

async function reuse(context) {
  const existing = await context.providers.getServiceDeploymentFor();
  if (existing) return report(context, 'reuse', existing);
  const clone = await context.providers.cloneServiceDeploymentFor(await runtimeFor(context));
  await report(context, 'clone', clone);
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
  // Settings stay out of the build output, so a redeploy can change them without a rebuild.
  const runtime = await runtimeFor(context);
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
