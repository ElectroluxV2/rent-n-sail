const { createHash } = require('node:crypto');
// Checked-in bundle: no install or registry access at run time; see vendor/package.json.
const sdk = require('./vendor/dist/sdk.cjs');

function serviceAlias(project, branch, target) {
  if (target === 'production') return `${project}.vercel.app`;
  const digest = createHash('sha256').update(`${project}:${branch}`).digest('hex').slice(0, 12);
  return `${project.slice(0, 42)}-preview-${digest}.vercel.app`;
}

function createProviders({ core, env = process.env }) {
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

  async function getProductionDatabase() {
    const selected = env.NEON_PARENT_BRANCH_ID;
    const branches = await neonRequest((client) =>
      client.branches.list({ projectId: env.NEON_PROJECT_ID }).all(),
    );
    const parent = branches.find((candidate) =>
      selected ? candidate.id === selected || candidate.name === selected : candidate.default,
    );
    if (!parent)
      throw new Error('Could not resolve the production parent; configure NEON_PARENT_BRANCH_ID.');
    core.info(`Selected production parent: ${parent.id}`);
    return parent.id;
  }

  async function getDatabasePreviewFor({ create = false } = {}) {
    const name = `preview/${branch}`;
    const branches = await neonRequest((client) =>
      client.branches.list({ projectId: env.NEON_PROJECT_ID, search: name }).all(),
    );
    let preview = branches.find((candidate) => candidate.name === name);
    if (preview) core.info(`Reusing Neon branch ${name} (${preview.id}).`);
    else {
      if (!create) throw new Error('Run the database workflow first to create its preview branch.');
      const parentId = await getProductionDatabase();
      preview = await neonRequest((client) =>
        client.branches.create({ projectId: env.NEON_PROJECT_ID, name, parent_id: parentId }),
      );
      core.info(`Created Neon branch ${name} (${preview.id}).`);
    }
    return preview.id;
  }

  async function getDatabaseConnectionFor({ branchId, pooled }) {
    core.info(`Resolving private database connection for ${branchId} (pooled=${pooled}).`);
    const uri = await neonRequest((client) =>
      client.postgres.connectionString({ projectId: env.NEON_PROJECT_ID, branchId, pooled }),
    );
    core.setSecret(uri);
    return uri;
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

  async function serviceHostname(projectId) {
    const { name } = await vercelRequest(sdk.projectsGetProject, { idOrName: projectId });
    return serviceAlias(name, branch, target);
  }

  async function assignServiceAlias(hostname, deploymentId) {
    await vercelRequest(sdk.aliasesAssignAlias, {
      id: deploymentId,
      requestBody: { alias: hostname },
    });
  }

  async function getServiceDeploymentFor(projectId = env.VERCEL_PROJECT_ID) {
    const deployment = await latestServiceDeployment(projectId, target);
    if (!deployment) return null;
    const hostname = serviceAlias(deployment.name, branch, target);
    const alias = await ownedServiceAlias(hostname, projectId);
    return {
      id: deployment.uid,
      url: `https://${alias?.deploymentId === deployment.uid ? hostname : deployment.url}`,
    };
  }

  // Redeploys production as this branch's preview with only its environment changed: no build or
  // file transfer. Every service is deployed from main at least once.
  async function cloneServiceDeploymentFor(runtime) {
    const production = await latestServiceDeployment(env.VERCEL_PROJECT_ID, 'production');
    if (!production)
      throw new Error('No READY production deployment to clone; deploy it from main.');
    core.info(`Cloning production deployment ${production.uid} for ${branch}.`);
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
          env: runtime,
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
      if (attempt === 200) throw new Error(`Clone ${deployment.id} did not finish in 10 minutes.`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      deployment = await vercelRequest(sdk.deploymentsGetDeployment, { idOrUrl: deployment.id });
    }
    if (deployment.readyState !== 'READY')
      throw new Error(`Clone ${deployment.id} ended ${deployment.readyState}.`);
    return assignServiceDeploymentFor(`https://${deployment.url}`);
  }

  async function getBackendServiceRuntime() {
    const frontendProject = env.VERCEL_FRONTEND_PROJECT_ID;
    const hostname = await serviceHostname(frontendProject);
    if (target === 'preview' && !(await ownedServiceAlias(hostname, frontendProject))) {
      // Reserve ownership before trusting this exact origin for CORS.
      const production = await latestServiceDeployment(frontendProject, 'production');
      await assignServiceAlias(hostname, production.uid);
    }
    const branchId =
      target === 'production' ? await getProductionDatabase() : await getDatabasePreviewFor();
    return {
      CORS_ALLOWED_ORIGINS: `https://${hostname}`,
      DATABASE_URL: await getDatabaseConnectionFor({ branchId, pooled: true }),
      // Passkey ceremonies run on the frontend origin that calls this backend.
      WEBAUTHN_ORIGIN: `https://${hostname}`,
      WEBAUTHN_RP_ID: hostname,
    };
  }

  async function getFrontendServiceRuntime() {
    const backend = await getServiceDeploymentFor(env.VERCEL_BACKEND_PROJECT_ID);
    if (!backend) throw new Error('Run the backend workflow first to deploy its preview.');
    return {
      BACKEND_URL: backend.url,
      FRONTEND_URL: `https://${await serviceHostname(env.VERCEL_FRONTEND_PROJECT_ID)}`,
    };
  }

  async function assignServiceDeploymentFor(url) {
    const { id } = await vercelRequest(sdk.deploymentsGetDeployment, {
      idOrUrl: new URL(url).hostname,
    });
    const hostname = await serviceHostname(env.VERCEL_PROJECT_ID);
    await ownedServiceAlias(hostname, env.VERCEL_PROJECT_ID);
    await assignServiceAlias(hostname, id);
    return { id, url: `https://${hostname}` };
  }

  return {
    getProductionDatabase,
    getDatabasePreviewFor,
    getDatabaseConnectionFor,
    getServiceDeploymentFor,
    cloneServiceDeploymentFor,
    getBackendServiceRuntime,
    getFrontendServiceRuntime,
    assignServiceDeploymentFor,
  };
}

module.exports = { createProviders };
