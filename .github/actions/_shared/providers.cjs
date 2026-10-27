const { createHash } = require('node:crypto');

function aliasName(project, branch, target) {
  if (target === 'production') return `${project}.vercel.app`;
  const digest = createHash('sha256').update(`${project}:${branch}`).digest('hex').slice(0, 12);
  return `${project.slice(0, 42)}-preview-${digest}.vercel.app`;
}

// Standalone Vercel functions return { ok, value, error }; throw like the Neon client does.
function vercelClient(sdk, env) {
  const core = new sdk.VercelCore({
    bearerToken: env.VERCEL_TOKEN,
    timeoutMs: 60_000,
    retryConfig: { strategy: 'none' },
  });
  const call = (operation) => async (request) => {
    const result = await operation(core, request);
    if (!result.ok) throw result.error;
    return result.value;
  };
  return {
    getProject: call(sdk.projectsGetProject),
    getDeployments: call(sdk.deploymentsGetDeployments),
    getDeployment: call(sdk.deploymentsGetDeployment),
    getAlias: call(sdk.aliasesGetAlias),
    assignAlias: call(sdk.aliasesAssignAlias),
  };
}

function createProviders({ core, env = process.env, clients = {} }) {
  const secrets = Object.entries(env)
    .filter(([name]) => /TOKEN|API_KEY|DATABASE_URL/.test(name))
    .map(([, value]) => value)
    .filter(Boolean);
  const project = env.NEON_PROJECT_ID;
  const defaults = {
    branch: env.DEPLOY_BRANCH,
    target: env.DEPLOY_TARGET,
    projectId: env.VERCEL_PROJECT_ID,
  };

  function client(provider) {
    if (!clients[provider]) {
      // Checked-in bundle: no install or registry access at run time; see vendor/src/build.mjs.
      const sdk = require('./vendor/sdk.cjs');
      clients[provider] =
        provider === 'vercel'
          ? vercelClient(sdk, env)
          : sdk.createNeonClient({
              apiKey: env.NEON_API_KEY,
              throwOnError: true,
              retries: 0,
              requestTimeoutMs: 60_000,
              waitForReadiness: false,
            });
    }
    return clients[provider];
  }

  async function request(provider, operation, missing = false) {
    const sdk = client(provider);
    try {
      return await operation(sdk);
    } catch (error) {
      const status = error.statusCode ?? error.status;
      if (missing && status === 404) return null;
      // SDK errors can retain raw bodies and connection details; expose status only.
      throw new Error(`${provider} request failed (HTTP ${status ?? 'unknown'}).`);
    }
  }

  async function getProductionDatabase() {
    const selected = env.NEON_PARENT_BRANCH_ID;
    const branches = await request('neon', (sdk) =>
      sdk.branches.list({ projectId: project }).all(),
    );
    const parent = branches.find((branch) =>
      selected ? branch.id === selected || branch.name === selected : branch.default,
    );
    if (!parent)
      throw new Error('Could not resolve the production parent; configure NEON_PARENT_BRANCH_ID.');
    core.info(`Selected production parent: ${parent.id}`);
    return parent.id;
  }

  async function getDatabasePreviewFor({ branch = defaults.branch, create = false } = {}) {
    const name = `preview/${branch}`;
    const branches = await request('neon', (sdk) =>
      sdk.branches.list({ projectId: project, search: name }).all(),
    );
    let preview = branches.find((candidate) => candidate.name === name);
    if (preview) core.info(`Reusing Neon branch ${name} (${preview.id}).`);
    else {
      if (!create) throw new Error('Run the database workflow first to create its preview branch.');
      const parentId = await getProductionDatabase();
      preview = await request('neon', (sdk) =>
        sdk.branches.create({ projectId: project, name, parent_id: parentId }),
      );
      core.info(`Created Neon branch ${name} (${preview.id}).`);
    }
    return preview.id;
  }

  async function getDatabaseConnectionFor({ branchId, pooled }) {
    core.info(`Resolving private database connection for ${branchId} (pooled=${pooled}).`);
    const uri = await request('neon', (sdk) =>
      sdk.postgres.connectionString({
        projectId: project,
        branchId,
        pooled,
        databaseName: env.NEON_DATABASE_NAME || 'neondb',
        roleName: env.NEON_ROLE_NAME || 'neondb_owner',
      }),
    );
    secrets.push(uri);
    core.setSecret(uri);
    return uri;
  }

  async function latestDeployment({ projectId, branch, target }) {
    const { deployments } = await request('vercel', (sdk) =>
      sdk.getDeployments({
        teamId: env.VERCEL_ORG_ID,
        projectId,
        state: 'READY',
        target,
        limit: 1,
        branch: target === 'preview' ? branch : undefined,
      }),
    );
    if (!deployments.length)
      throw new Error(
        `No READY ${target} deployment for ${projectId}. Run its workflow with build=true once.`,
      );
    return deployments[0];
  }

  async function ownedAlias(hostname, projectId) {
    const alias = await request(
      'vercel',
      (sdk) => sdk.getAlias({ idOrAlias: hostname, teamId: env.VERCEL_ORG_ID }),
      true,
    );
    if (alias && alias.projectId !== projectId)
      throw new Error('The requested alias belongs to another project.');
    return alias;
  }

  async function applicationHostname({ projectId, branch, target }) {
    const { name } = await request('vercel', (sdk) =>
      sdk.getProject({ idOrName: projectId, teamId: env.VERCEL_ORG_ID }),
    );
    return aliasName(name, branch, target);
  }

  async function assignAlias(hostname, deploymentId) {
    await request('vercel', (sdk) =>
      sdk.assignAlias({
        id: deploymentId,
        teamId: env.VERCEL_ORG_ID,
        requestBody: { alias: hostname },
      }),
    );
  }

  async function getApplicationDeploymentFor(params = {}) {
    const selection = { ...defaults, ...params };
    const deployment = await latestDeployment(selection);
    const hostname = aliasName(deployment.name, selection.branch, selection.target);
    const alias = await ownedAlias(hostname, selection.projectId);
    return {
      id: deployment.uid,
      url: `https://${alias?.deploymentId === deployment.uid ? hostname : deployment.url}`,
    };
  }

  async function getApplicationRuntimeFor({ application, ...params }) {
    const selection = { ...defaults, ...params };
    if (application === 'frontend')
      return {
        BACKEND_URL: (
          await getApplicationDeploymentFor({
            ...selection,
            projectId: env.VERCEL_BACKEND_PROJECT_ID,
          })
        ).url,
        FRONTEND_URL: `https://${await applicationHostname(selection)}`,
      };
    const frontend = { ...selection, projectId: env.VERCEL_FRONTEND_PROJECT_ID };
    const hostname = await applicationHostname(frontend);
    const alias = await ownedAlias(hostname, frontend.projectId);
    if (selection.target === 'preview' && !alias) {
      // Reserve ownership before trusting this exact origin for CORS.
      await assignAlias(
        hostname,
        (await latestDeployment({ ...frontend, target: 'production' })).uid,
      );
    }
    const branchId =
      selection.target === 'production'
        ? await getProductionDatabase()
        : await getDatabasePreviewFor({ branch: selection.branch });
    return {
      CORS_ALLOWED_ORIGINS: `https://${hostname}`,
      DATABASE_URL: await getDatabaseConnectionFor({ branchId, pooled: true }),
      // Passkey ceremonies run on the frontend origin that calls this backend.
      WEBAUTHN_ORIGIN: `https://${hostname}`,
      WEBAUTHN_RP_ID: hostname,
    };
  }

  async function assignApplicationDeploymentFor({ url, ...params }) {
    const selection = { ...defaults, ...params };
    const { id } = await request('vercel', (sdk) =>
      sdk.getDeployment({ idOrUrl: new URL(url).hostname, teamId: env.VERCEL_ORG_ID }),
    );
    const hostname = await applicationHostname(selection);
    await ownedAlias(hostname, selection.projectId);
    await assignAlias(hostname, id);
    return { id, url: `https://${hostname}` };
  }

  function sanitize(text) {
    for (const secret of secrets) text = text.split(secret).join('<REDACTED>');
    return text.replace(/postgres(?:ql)?(?:\+\w+)?:\/\/[^\s"<>]+/gi, '<REDACTED DATABASE URL>');
  }

  return {
    getProductionDatabase,
    getDatabasePreviewFor,
    getDatabaseConnectionFor,
    getApplicationDeploymentFor,
    getApplicationRuntimeFor,
    assignApplicationDeploymentFor,
    sanitize,
  };
}

module.exports = { createProviders };
