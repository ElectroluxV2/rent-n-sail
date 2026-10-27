const { createHash } = require('node:crypto');

function required(env, name) {
  if (!env[name]) throw new Error(`Configure ${name} before deploying.`);
  return env[name];
}

function aliasName(project, branch, target) {
  if (target === 'production') return `${project}.vercel.app`;
  const digest = createHash('sha256').update(`${project}:${branch}`).digest('hex').slice(0, 12);
  return `${project.slice(0, 42)}-preview-${digest}.vercel.app`;
}

class Providers {
  constructor({ core, env = process.env }) {
    this.core = core;
    this.env = env;
    this.secrets = Object.entries(env)
      .filter(([name]) => /TOKEN|API_KEY|DATABASE_URL/.test(name))
      .map(([, value]) => value)
      .filter(Boolean);
  }

  secret(value) {
    this.secrets.push(value);
    this.core.setSecret(value);
    return value;
  }

  sanitize(text) {
    for (const secret of this.secrets) text = text.split(secret).join('<REDACTED>');
    return text.replace(/postgres(?:ql)?(?:\+\w+)?:\/\/[^\s"<>]+/gi, '<REDACTED DATABASE URL>');
  }

  async request(provider, method, route, { data, missing = false } = {}) {
    const url = new URL(
      `${provider === 'neon' ? 'https://console.neon.tech/api/v2' : 'https://api.vercel.com'}${route}`,
    );
    const token = required(this.env, provider === 'neon' ? 'NEON_API_KEY' : 'VERCEL_TOKEN');
    if (provider === 'vercel') url.searchParams.set('teamId', required(this.env, 'VERCEL_ORG_ID'));
    const response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: AbortSignal.timeout(60_000),
    });
    if (missing && response.status === 404) return null;
    // Provider error bodies can contain private connection details; report status only.
    if (!response.ok) throw new Error(`${provider} ${method} failed (HTTP ${response.status}).`);
    return response.json();
  }

  project(id) {
    return this.request('vercel', 'GET', `/v9/projects/${encodeURIComponent(id)}`);
  }

  async latest(project, target = this.env.DEPLOY_TARGET) {
    const query = new URLSearchParams({ projectId: project, state: 'READY', target, limit: '1' });
    if (target === 'preview') query.set('branch', this.env.DEPLOY_BRANCH);
    const { deployments } = await this.request('vercel', 'GET', `/v7/deployments?${query}`);
    if (!deployments.length)
      throw new Error(
        `No READY ${target} deployment for ${project}. Run its workflow with build=true once.`,
      );
    return deployments[0];
  }

  async alias(hostname, project) {
    const alias = await this.request(
      'vercel',
      'GET',
      `/v4/aliases/${encodeURIComponent(hostname)}`,
      { missing: true },
    );
    if (alias && alias.projectId !== project)
      throw new Error('The requested alias belongs to another project.');
    return alias;
  }

  async assign(hostname, project, deployment) {
    await this.alias(hostname, project);
    await this.request(
      'vercel',
      'POST',
      `/v2/deployments/${encodeURIComponent(deployment)}/aliases`,
      { data: { alias: hostname } },
    );
  }

  async parent() {
    const selected = this.env.NEON_PARENT_BRANCH_ID;
    const { branches } = await this.request(
      'neon',
      'GET',
      `/projects/${required(this.env, 'NEON_PROJECT_ID')}/branches`,
    );
    const parent = branches.find((branch) =>
      selected ? branch.id === selected || branch.name === selected : branch.default,
    );
    if (!parent)
      throw new Error('Could not resolve the production parent; configure NEON_PARENT_BRANCH_ID.');
    this.core.info(`Selected production parent: ${parent.id}`);
    return parent.id;
  }

  async branch(create = false) {
    if (this.env.DEPLOY_TARGET === 'production') return this.parent();
    const name = `preview/${required(this.env, 'DEPLOY_BRANCH')}`;
    const route = `/projects/${required(this.env, 'NEON_PROJECT_ID')}/branches`;
    const { branches } = await this.request('neon', 'GET', route);
    let branch = branches.find((branch) => branch.name === name);
    if (branch) this.core.info(`Reusing Neon branch ${name} (${branch.id}).`);
    else {
      if (!create) throw new Error('Run the database workflow first to create its preview branch.');
      ({ branch } = await this.request('neon', 'POST', route, {
        data: {
          branch: { name, parent_id: await this.parent() },
          endpoints: [{ type: 'read_write' }],
        },
      }));
      this.core.info(`Created Neon branch ${name} (${branch.id}).`);
    }
    return branch.id;
  }

  async connection(branch, pooled) {
    this.core.info(`Resolving private database connection for ${branch} (pooled=${pooled}).`);
    const query = new URLSearchParams({
      branch_id: branch,
      database_name: this.env.NEON_DATABASE_NAME || 'neondb',
      role_name: this.env.NEON_ROLE_NAME || 'neondb_owner',
      pooled: String(pooled),
    });
    const { uri } = await this.request(
      'neon',
      'GET',
      `/projects/${required(this.env, 'NEON_PROJECT_ID')}/connection_uri?${query}`,
    );
    return this.secret(uri);
  }
}

module.exports = { Providers, required, aliasName };
