const { createHash } = require('node:crypto');

function aliasName(project, branch, target) {
  if (target === 'production') return `${project}.vercel.app`;
  const digest = createHash('sha256').update(`${project}:${branch}`).digest('hex').slice(0, 12);
  return `${project.slice(0, 42)}-preview-${digest}.vercel.app`;
}

function createProviders({ core, env = process.env }) {
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

  async function request(provider, method, route, data, missing = false) {
    const url = new URL(
      `${provider === 'neon' ? 'https://console.neon.tech/api/v2' : 'https://api.vercel.com'}${route}`,
    );
    const token = env[provider === 'neon' ? 'NEON_API_KEY' : 'VERCEL_TOKEN'];
    if (!token) throw new Error(`Configure the ${provider} API token before deploying.`);
    if (provider === 'vercel') url.searchParams.set('teamId', env.VERCEL_ORG_ID);
    const response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: AbortSignal.timeout(60_000),
    });
    if (missing && response.status === 404) return null;
    // Error bodies can contain private connection details; report status only.
    if (!response.ok) throw new Error(`${provider} ${method} failed (HTTP ${response.status}).`);
    return response.json();
  }

  async function databaseBranches(search) {
    const branches = [];
    let cursor;
    do {
      const query = new URLSearchParams({ limit: '100' });
      if (search) query.set('search', search);
      if (cursor) query.set('cursor', cursor);
      const page = await request('neon', 'GET', `/projects/${project}/branches?${query}`);
      branches.push(...page.branches);
      cursor = page.pagination?.next;
    } while (cursor);
    return branches;
  }

  async function getProductionDatabase() {
    const selected = env.NEON_PARENT_BRANCH_ID;
    const parent = (await databaseBranches()).find((branch) =>
      selected ? branch.id === selected || branch.name === selected : branch.default,
    );
    if (!parent)
      throw new Error('Could not resolve the production parent; configure NEON_PARENT_BRANCH_ID.');
    core.info(`Selected production parent: ${parent.id}`);
    return parent.id;
  }

  async function getDatabasePreviewFor({ branch = defaults.branch, create = false } = {}) {
    const name = `preview/${branch}`;
    let preview = (await databaseBranches(name)).find((candidate) => candidate.name === name);
    if (preview) core.info(`Reusing Neon branch ${name} (${preview.id}).`);
    else {
      if (!create) throw new Error('Run the database workflow first to create its preview branch.');
      ({ branch: preview } = await request('neon', 'POST', `/projects/${project}/branches`, {
        branch: { name, parent_id: await getProductionDatabase() },
        endpoints: [{ type: 'read_write' }],
      }));
      core.info(`Created Neon branch ${name} (${preview.id}).`);
    }
    return preview.id;
  }

  async function getDatabaseConnectionFor({ branchId, pooled }) {
    core.info(`Resolving private database connection for ${branchId} (pooled=${pooled}).`);
    const query = new URLSearchParams({
      branch_id: branchId,
      pooled: String(pooled),
      database_name: env.NEON_DATABASE_NAME || 'neondb',
      role_name: env.NEON_ROLE_NAME || 'neondb_owner',
    });
    const { uri } = await request('neon', 'GET', `/projects/${project}/connection_uri?${query}`);
    secrets.push(uri);
    core.setSecret(uri);
    return uri;
  }

  async function latestDeployment({ projectId, branch, target }) {
    const query = new URLSearchParams({ projectId, state: 'READY', target, limit: '1' });
    if (target === 'preview') query.set('branch', branch);
    const { deployments } = await request('vercel', 'GET', `/v7/deployments?${query}`);
    if (!deployments.length)
      throw new Error(
        `No READY ${target} deployment for ${projectId}. Run its workflow with build=true once.`,
      );
    return deployments[0];
  }

  async function ownedAlias(hostname, projectId) {
    const alias = await request(
      'vercel',
      'GET',
      `/v4/aliases/${encodeURIComponent(hostname)}`,
      undefined,
      true,
    );
    if (alias && alias.projectId !== projectId)
      throw new Error('The requested alias belongs to another project.');
    return alias;
  }

  async function applicationHostname({ projectId, branch, target }) {
    const { name } = await request(
      'vercel',
      'GET',
      `/v9/projects/${encodeURIComponent(projectId)}`,
    );
    return aliasName(name, branch, target);
  }

  async function assignAlias(hostname, deploymentId) {
    await request('vercel', 'POST', `/v2/deployments/${encodeURIComponent(deploymentId)}/aliases`, {
      alias: hostname,
    });
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
    };
  }

  async function assignApplicationDeploymentFor({ url, ...params }) {
    const selection = { ...defaults, ...params };
    const { id } = await request(
      'vercel',
      'GET',
      `/v13/deployments/${encodeURIComponent(new URL(url).hostname)}`,
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
