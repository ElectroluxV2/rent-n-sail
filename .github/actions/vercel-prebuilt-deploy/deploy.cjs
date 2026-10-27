const fs = require('node:fs/promises');
const path = require('node:path');
const { Providers, aliasName } = require('../_shared/providers.cjs');
const { command, buildEnvironment } = require('../_shared/commands.cjs');
const { packageFrontend, bindRuntime } = require('./output.cjs');

async function existingDeployment(provider, project) {
  const deployment = await provider.latest(project);
  const { DEPLOY_BRANCH: branch, DEPLOY_TARGET: target } = provider.env;
  const hostname = aliasName(deployment.name, branch, target);
  const alias = await provider.alias(hostname, project);
  return {
    id: deployment.uid,
    url: `https://${alias?.deploymentId === deployment.uid ? hostname : deployment.url}`,
  };
}

async function report(provider, mode, { id, url }) {
  const { core, env } = provider;
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

async function vercel(provider, exec, args, env = provider.env) {
  const result = await command(exec, 'vercel', args, { env, allowFailure: true });
  provider.core.info(provider.sanitize(result.stdout));
  provider.core.info(provider.sanitize(result.stderr));
  if (result.exitCode) throw new Error(`Vercel ${args[0]} failed; see sanitized CLI output.`);
  return result.stdout.trim();
}

async function reuse(provider) {
  await report(
    provider,
    'reuse',
    await existingDeployment(provider, provider.env.VERCEL_PROJECT_ID),
  );
}

async function pull(provider, exec) {
  const { env } = provider;
  const args = [
    'pull',
    '--local-config',
    env.VERCEL_LOCAL_CONFIG,
    '--yes',
    '--environment',
    env.DEPLOY_TARGET,
  ];
  if (env.DEPLOY_TARGET === 'preview') args.push('--git-branch', env.DEPLOY_BRANCH);
  await vercel(provider, exec, args);
}

async function build(provider, exec) {
  const { env } = provider;
  if (env.COMPONENT === 'frontend') {
    await packageFrontend('frontend/dist/frontend', '.vercel/output');
    provider.core.info('Packaged the validated Angular SSR build; no second build.');
  } else {
    // Bind private configuration at publication, never during compilation.
    for (const name of await fs.readdir('.vercel')) {
      if (name.startsWith('.env.')) await fs.writeFile(path.join('.vercel', name), '');
    }
    await vercel(
      provider,
      exec,
      ['build', '--local-config', env.VERCEL_LOCAL_CONFIG, '--environment', env.DEPLOY_TARGET],
      buildEnvironment(env),
    );
  }
}

async function publish(provider, exec) {
  const { env } = provider;
  const { DEPLOY_BRANCH: branch, DEPLOY_TARGET: target, VERCEL_PROJECT_ID: project } = env;
  const { name } = await provider.project(project);
  const hostname = aliasName(name, branch, target);
  let runtime;
  if (env.COMPONENT === 'backend') {
    const frontend = env.VERCEL_FRONTEND_PROJECT_ID;
    const frontendHost = aliasName((await provider.project(frontend)).name, branch, target);
    const frontendAlias = await provider.alias(frontendHost, frontend);
    if (target === 'preview' && !frontendAlias) {
      // Reserve/verify ownership before trusting this exact origin for CORS.
      await provider.assign(
        frontendHost,
        frontend,
        (await provider.latest(frontend, 'production')).uid,
      );
    }
    runtime = {
      CORS_ALLOWED_ORIGINS: `https://${frontendHost}`,
      DATABASE_URL: await provider.connection(await provider.branch(), true),
    };
  } else {
    runtime = {
      BACKEND_URL: (await existingDeployment(provider, env.VERCEL_BACKEND_PROJECT_ID)).url,
      FRONTEND_URL: `https://${hostname}`,
    };
  }
  await bindRuntime('.vercel/output/functions', runtime);
  const args = [
    'deploy',
    '--prebuilt',
    '--local-config',
    env.VERCEL_LOCAL_CONFIG,
    '--environment',
    target,
    '--meta',
    'githubDeployment=1',
    '--meta',
    `githubCommitRef=${branch}`,
    '--meta',
    `githubCommitSha=${env.GITHUB_SHA}`,
  ];
  for (const key of Object.keys(runtime)) args.push('--env', key);
  const url = await vercel(provider, exec, args, { ...env, ...runtime });
  // The CLI waits for READY. Look up only the ID needed to assign the stable URL.
  const { id } = await provider.request(
    'vercel',
    'GET',
    `/v13/deployments/${encodeURIComponent(new URL(url).hostname)}`,
  );
  await provider.assign(hostname, project, id);
  await report(provider, 'build', { id, url: `https://${hostname}` });
}

module.exports = async ({ core, exec, env = process.env }) => {
  const provider = new Providers({ core, env });
  await { reuse, pull, build, publish }[env.DEPLOY_OPERATION](provider, exec);
};
Object.assign(module.exports, { existingDeployment, reuse, pull, build, publish });
