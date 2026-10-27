const { createHash } = require('node:crypto');
// Checked-in bundle: no install or registry access at run time; see vendor/package.json.
const sdk = require('./vendor/dist/sdk.cjs');

function serviceAlias(project, branch, target) {
  if (target === 'production') return `${project}.vercel.app`;
  const digest = createHash('sha256').update(`${project}:${branch}`).digest('hex').slice(0, 12);
  return `${project.slice(0, 42)}-preview-${digest}.vercel.app`;
}

// Neon helpers say "Database", Vercel helpers say "Service"; both describe an instance as { id, address }.
function createProviders({ core, exec, env = process.env }) {
  const branch = env.DEPLOY_BRANCH;
  const target = env.DEPLOY_TARGET;
  let neon;
  let vercel;

  async function neonRequest(operation) {
    neon ??= sdk.createNeonClient({
      apiKey: env.NEON_API_KEY,
      throwOnError: true,
      retries: 0,
      requestTimeoutMs: 60_000,
      waitForReadiness: false,
    });
    return operation(neon);
  }

  // Standalone Vercel functions return { ok, value, error } instead of throwing.
  async function vercelRequest(operation, request, { nullIfNotFound = false } = {}) {
    vercel ??= new sdk.VercelCore({
      bearerToken: env.VERCEL_TOKEN,
      timeoutMs: 60_000,
      retryConfig: { strategy: 'none' },
    });
    const result = await operation(vercel, { teamId: env.VERCEL_ORG_ID, ...request });
    if (result.ok) return result.value;
    if (nullIfNotFound && result.error.statusCode === 404) return null;
    throw result.error;
  }

  async function getProductionDatabaseBranch() {
    const selected = env.NEON_PARENT_BRANCH_ID;
    const branches = await neonRequest((client) =>
      client.branches.list({ projectId: env.NEON_PROJECT_ID }).all(),
    );
    const source = branches.find((candidate) =>
      selected ? candidate.id === selected || candidate.name === selected : candidate.default,
    );
    if (!source)
      throw new Error('Could not resolve the production source; configure NEON_PARENT_BRANCH_ID.');
    return { id: source.id, address: source.name };
  }

  function databaseBranchName() {
    return `preview/${branch}`;
  }

  async function findDatabaseBranch() {
    if (target === 'production') return getProductionDatabaseBranch();
    const name = databaseBranchName();
    const branches = await neonRequest((client) =>
      client.branches.list({ projectId: env.NEON_PROJECT_ID, search: name }).all(),
    );
    const found = branches.find((candidate) => candidate.name === name);
    return found ? { id: found.id, address: name } : null;
  }

  async function forkDatabaseBranch() {
    const source = await getProductionDatabaseBranch();
    const name = databaseBranchName();
    core.info(`Forking production source ${source.address} (${source.id}) as ${name}.`);
    const { id } = await neonRequest((client) =>
      client.branches.create({ projectId: env.NEON_PROJECT_ID, name, parent_id: source.id }),
    );
    return { id, address: name };
  }

  async function getDatabaseConnection(pooled) {
    const database = await findDatabaseBranch();
    if (!database) throw new Error('Run the database workflow first to create its preview.');
    core.info(`Resolving the ${pooled ? 'pooled' : 'direct'} connection to ${database.address}.`);
    const uri = await neonRequest((client) =>
      client.postgres.connectionString({
        projectId: env.NEON_PROJECT_ID,
        branchId: database.id,
        pooled,
      }),
    );
    core.setSecret(uri);
    return uri;
  }

  async function getDatabaseSettings() {
    return { DATABASE_URL: await getDatabaseConnection(false) };
  }

  async function latestServiceDeployment(projectId, deploymentTarget) {
    const { deployments } = await vercelRequest(sdk.deploymentsGetDeployments, {
      projectId,
      state: 'READY',
      target: deploymentTarget,
      limit: 1,
      branch: deploymentTarget === 'preview' ? branch : undefined,
    });
    return deployments[0];
  }

  async function ownedServiceAlias(hostname, projectId) {
    const alias = await vercelRequest(
      sdk.aliasesGetAlias,
      { idOrAlias: hostname },
      { nullIfNotFound: true },
    );
    if (alias && alias.projectId !== projectId)
      throw new Error('The requested alias belongs to another project.');
    return alias;
  }

  async function serviceAddress(projectId) {
    const { name } = await vercelRequest(sdk.projectsGetProject, { idOrName: projectId });
    return serviceAlias(name, branch, target);
  }

  async function assignServiceAlias(hostname, deploymentId) {
    await vercelRequest(sdk.aliasesAssignAlias, {
      id: deploymentId,
      requestBody: { alias: hostname },
    });
  }

  async function findServiceDeployment(projectId = env.VERCEL_PROJECT_ID) {
    const deployment = await latestServiceDeployment(projectId, target);
    if (!deployment) return null;
    const hostname = serviceAlias(deployment.name, branch, target);
    const alias = await ownedServiceAlias(hostname, projectId);
    return {
      id: deployment.uid,
      address: `https://${alias?.deploymentId === deployment.uid ? hostname : deployment.url}`,
    };
  }

  async function pointServiceAlias(url) {
    const { id } = await vercelRequest(sdk.deploymentsGetDeployment, {
      idOrUrl: new URL(url).hostname,
    });
    const hostname = await serviceAddress(env.VERCEL_PROJECT_ID);
    await ownedServiceAlias(hostname, env.VERCEL_PROJECT_ID);
    await assignServiceAlias(hostname, id);
    return { id, address: `https://${hostname}` };
  }

  // Redeploys production as this branch's preview with only its settings changed: no build or
  // file transfer. Every service is deployed from main at least once.
  async function forkServiceDeployment(settings) {
    const production = await latestServiceDeployment(env.VERCEL_PROJECT_ID, 'production');
    if (!production)
      throw new Error('No READY production deployment to fork; deploy it from main.');
    core.info(`Forking production deployment ${production.uid} for ${branch}.`);
    const response = await fetch(
      `https://api.vercel.com/v13/deployments?teamId=${env.VERCEL_ORG_ID}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.VERCEL_TOKEN}`,
          'Content-Type': 'application/json',
        },
        // `env` is the undocumented field `vercel deploy --env` sends; omitting `target` makes the
        // redeployment a preview, as `vercel redeploy --environment preview` does.
        body: JSON.stringify({
          deploymentId: production.uid,
          name: production.name,
          project: env.VERCEL_PROJECT_ID,
          env: settings,
          meta: { githubDeployment: '1', githubCommitRef: branch, githubCommitSha: env.GITHUB_SHA },
        }),
      },
    );
    let deployment = await response.json();
    if (!response.ok)
      throw new Error(
        `Vercel redeploy failed (HTTP ${response.status}): ${deployment.error?.message}`,
      );
    for (
      let attempt = 0;
      !['READY', 'ERROR', 'CANCELED'].includes(deployment.readyState);
      attempt++
    ) {
      if (attempt === 200) throw new Error(`Fork ${deployment.id} did not finish in 10 minutes.`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      deployment = await vercelRequest(sdk.deploymentsGetDeployment, { idOrUrl: deployment.id });
    }
    if (deployment.readyState !== 'READY')
      throw new Error(`Fork ${deployment.id} ended ${deployment.readyState}.`);
    return pointServiceAlias(`https://${deployment.url}`);
  }

  async function reserveServiceAlias(projectId) {
    const hostname = await serviceAddress(projectId);
    if (target === 'preview' && !(await ownedServiceAlias(hostname, projectId))) {
      // Reserve ownership before trusting this exact origin for CORS.
      const production = await latestServiceDeployment(projectId, 'production');
      await assignServiceAlias(hostname, production.uid);
    }
    return hostname;
  }

  async function getBackendServiceSettings() {
    const frontend = await reserveServiceAlias(env.VERCEL_FRONTEND_PROJECT_ID);
    return {
      CORS_ALLOWED_ORIGINS: `https://${frontend}`,
      DATABASE_URL: await getDatabaseConnection(true),
      // Passkey ceremonies run on the frontend origin that calls this backend.
      WEBAUTHN_ORIGIN: `https://${frontend}`,
      WEBAUTHN_RP_ID: frontend,
    };
  }

  async function getFrontendServiceSettings() {
    const backend = await findServiceDeployment(env.VERCEL_BACKEND_PROJECT_ID);
    if (!backend) throw new Error('Run the backend workflow first to deploy its preview.');
    return {
      BACKEND_URL: backend.address,
      FRONTEND_URL: `https://${await serviceAddress(env.VERCEL_FRONTEND_PROJECT_ID)}`,
    };
  }

  async function vercelCli(args) {
    if (env.VERCEL_LOCAL_CONFIG) args.push('--local-config', env.VERCEL_LOCAL_CONFIG);
    const { stdout } = await exec.getExecOutput('vercel', args, { env });
    return stdout.trim();
  }

  async function pullServiceConfig() {
    const args = ['pull', '--yes', '--environment', target];
    if (target === 'preview') args.push('--git-branch', branch);
    await vercelCli(args);
  }

  async function buildServiceOutput() {
    await vercelCli(['build', '--environment', target]);
  }

  async function publishServiceDeployment(settingNames) {
    const args = [
      'deploy',
      '--prebuilt',
      '--environment',
      target,
      '--meta',
      'githubDeployment=1',
      '--meta',
      `githubCommitRef=${branch}`,
      '--meta',
      `githubCommitSha=${env.GITHUB_SHA}`,
    ];
    // Valueless --env reads each setting from the job environment, keeping values out of arguments.
    for (const name of settingNames) args.push('--env', name);
    // The CLI waits for READY.
    return pointServiceAlias(await vercelCli(args));
  }

  return {
    findDatabaseBranch,
    forkDatabaseBranch,
    getDatabaseSettings,
    findServiceDeployment,
    forkServiceDeployment,
    getBackendServiceSettings,
    getFrontendServiceSettings,
    pullServiceConfig,
    buildServiceOutput,
    publishServiceDeployment,
  };
}

module.exports = { createProviders };
