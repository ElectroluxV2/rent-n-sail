const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

function required(env, name) {
  if (!env[name]) throw new Error(`Configure ${name} before deploying.`);
  return env[name];
}

function redact(text, secrets = []) {
  let result = String(text);
  for (const secret of secrets) {
    if (secret) result = result.split(secret).join('<REDACTED>');
  }
  return result
    .replace(/postgres(?:ql)?(?:\+\w+)?:\/\/[^\s"<>]+/gi, '<REDACTED DATABASE URL>')
    .replace(/(x-vercel-protection-bypass[:=])\s*\S+/gi, '$1<REDACTED>');
}

async function writePrivate(filename, value) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = path.join(path.dirname(filename), `.rns-${randomUUID()}.json`);
  await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await fs.rename(temporary, filename);
}

function aliasName(project, branch, target) {
  if (target === 'production') return `${project}.vercel.app`;
  const digest = createHash('sha256').update(`${project}:${branch}`).digest('hex').slice(0, 12);
  return `${project.slice(0, 42)}-preview-${digest}.vercel.app`;
}

function selectDeployment(deployments, branch, target) {
  return (
    deployments
      .filter((deployment) => (deployment.readyState ?? deployment.state) === 'READY')
      .filter((deployment) =>
        target === 'production'
          ? deployment.target === 'production'
          : deployment.target !== 'production' && deployment.meta?.githubCommitRef === branch,
      )
      .sort((a, b) => (b.createdAt ?? b.created ?? 0) - (a.createdAt ?? a.created ?? 0))[0] ?? null
  );
}

class Providers {
  constructor({ core, github, env = process.env, fetchImpl = globalThis.fetch, sleep = delay }) {
    this.core = core;
    this.github = github;
    this.env = env;
    this.fetch = fetchImpl;
    this.sleep = sleep;
    this.secrets = new Set(
      Object.entries(env)
        .filter(([name]) => /TOKEN|API_KEY|DATABASE_URL/.test(name))
        .map(([, value]) => value)
        .filter(Boolean),
    );
  }

  secret(value) {
    this.secrets.add(value);
    this.core.setSecret(value);
    return value;
  }

  sanitize(text) {
    return redact(text, [...this.secrets]);
  }

  async request(provider, method, route, { data, missing = false } = {}) {
    if (provider === 'github') {
      try {
        return (await this.github.request(`${method} ${route}`, data)).data;
      } catch (error) {
        if (missing && error.status === 404) return null;
        throw new Error(`GitHub ${method} request failed (HTTP ${error.status ?? 'unknown'}).`);
      }
    }
    if (!['neon', 'vercel'].includes(provider)) throw new Error('Unknown provider.');
    const url = new URL(
      route,
      provider === 'neon' ? 'https://console.neon.tech/api/v2/' : 'https://api.vercel.com/',
    );
    // Neon routes are relative to /api/v2, not the host root.
    if (provider === 'neon') url.pathname = `/api/v2${url.pathname}`;
    const token = required(this.env, provider === 'neon' ? 'NEON_API_KEY' : 'VERCEL_TOKEN');
    if (provider === 'vercel') url.searchParams.set('teamId', required(this.env, 'VERCEL_ORG_ID'));
    for (let attempt = 0; attempt < 3; attempt++) {
      let response;
      try {
        response = await this.fetch(url, {
          method,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: data === undefined ? undefined : JSON.stringify(data),
          signal: AbortSignal.timeout(60_000),
        });
      } catch {
        throw new Error(`${provider} ${method} network request failed.`);
      }
      if (missing && response.status === 404) return null;
      if (response.ok) {
        try {
          return await response.json();
        } catch {
          throw new Error(`${provider} returned invalid JSON.`);
        }
      }
      if (method === 'GET' && [423, 429, 502, 503, 504].includes(response.status) && attempt < 2) {
        await this.sleep(2 ** attempt * 1000);
        continue;
      }
      const body = await response.json().catch(() => ({}));
      const message = body.message ?? body.error?.message;
      const detail =
        typeof message === 'string'
          ? this.sanitize(message)
              .replace(/https?:\/\/\S+/g, '<REDACTED URL>')
              .slice(0, 500)
          : '';
      throw new Error(`${provider} ${method} request failed: HTTP ${response.status}. ${detail}`);
    }
  }

  project(id) {
    return this.request('vercel', 'GET', `/v9/projects/${encodeURIComponent(id)}`);
  }

  async deployments(project) {
    const deployments = [];
    let cursor;
    for (let page = 0; page < 10; page++) {
      const query = new URLSearchParams({ projectId: project, state: 'READY', limit: '100' });
      if (cursor) query.set('until', String(cursor));
      const result = await this.request('vercel', 'GET', `/v6/deployments?${query}`);
      deployments.push(...result.deployments);
      cursor = result.pagination?.next;
      if (!cursor) return deployments;
    }
    throw new Error('Deployment history exceeds the pagination limit.');
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
    if ((await this.alias(hostname, project))?.deploymentId === deployment) return;
    await this.request(
      'vercel',
      'POST',
      `/v2/deployments/${encodeURIComponent(deployment)}/aliases`,
      { data: { alias: hostname } },
    );
  }

  async parent() {
    const project = required(this.env, 'NEON_PROJECT_ID');
    const selected = this.env.NEON_PARENT_BRANCH_ID;
    this.core.info(`Production parent selector: ${selected || 'project default'}`);
    const { branches } = await this.request(
      'neon',
      'GET',
      `/projects/${encodeURIComponent(project)}/branches`,
    );
    const matches = branches.filter((branch) =>
      selected ? branch.id === selected || branch.name === selected : branch.default,
    );
    if (matches.length !== 1)
      throw new Error('Could not resolve the production parent; configure NEON_PARENT_BRANCH_ID.');
    if (typeof matches[0].id !== 'string' || !matches[0].id)
      throw new Error('Neon did not return a production parent ID.');
    this.core.info(`Selected production parent: ${matches[0].id}`);
    return matches[0].id;
  }

  async branch(create = false) {
    if (this.env.DEPLOY_TARGET === 'production') return this.parent();
    const project = required(this.env, 'NEON_PROJECT_ID');
    const name = `preview/${required(this.env, 'DEPLOY_BRANCH')}`;
    const route = `/projects/${encodeURIComponent(project)}/branches`;
    const { branches } = await this.request('neon', 'GET', route);
    const matches = branches.filter((branch) => branch.name === name);
    if (matches.length > 1) throw new Error('The Neon preview name is ambiguous.');
    if (matches.length === 1) {
      if (typeof matches[0].id !== 'string' || !matches[0].id)
        throw new Error('Neon did not return a preview branch ID.');
      this.core.info(
        `Reusing existing Neon preview: ${name} (${matches[0].id}). No branch created.`,
      );
      return matches[0].id;
    }
    if (!create)
      throw new Error('No matching Neon preview exists. Run the database workflow first.');
    const parent = await this.parent();
    this.core.info(`No ${name} branch exists. Creating it from ${parent}.`);
    const result = await this.request('neon', 'POST', route, {
      data: { branch: { name, parent_id: parent }, endpoints: [{ type: 'read_write' }] },
    });
    if (!result.branch?.id) throw new Error('Neon did not return a created branch ID.');
    this.core.info(`Created Neon preview: ${name} (${result.branch.id}).`);
    return result.branch.id;
  }

  async connection(branch, pooled) {
    this.core.info(
      `Resolving private database connection for branch ${branch} (pooled=${pooled}).`,
    );
    const query = new URLSearchParams({
      branch_id: branch,
      database_name: this.env.NEON_DATABASE_NAME || 'neondb',
      role_name: this.env.NEON_ROLE_NAME || 'neondb_owner',
      pooled: String(pooled),
    });
    const result = await this.request(
      'neon',
      'GET',
      `/projects/${encodeURIComponent(required(this.env, 'NEON_PROJECT_ID'))}/connection_uri?${query}`,
    );
    if (typeof result.uri !== 'string' || !result.uri)
      throw new Error('Neon did not return a database connection.');
    return this.secret(result.uri);
  }
}

module.exports = { Providers, required, redact, writePrivate, aliasName, selectDeployment };
