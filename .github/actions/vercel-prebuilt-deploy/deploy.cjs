const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {
  Providers,
  required,
  writePrivate,
  aliasName,
  selectDeployment,
} = require('../_shared/providers.cjs');
const { command, buildEnvironment } = require('../_shared/commands.cjs');
const { packageFrontend, packOutput, restoreOutput, injectRuntime } = require('./artifacts.cjs');

function resolveMode(build, existing, production) {
  if (build) return 'build';
  if (existing) return 'reuse';
  if (production) return 'restore';
  throw new Error('No production output exists. Run this application with build=true once.');
}

async function deploymentUrl(provider, source, hostname, project) {
  if ((await provider.alias(hostname, project))?.deploymentId === (source.uid ?? source.id))
    return `https://${hostname}`;
  if (!source.url) throw new Error('The deployment has no public URL.');
  return source.url.startsWith('https://') ? source.url : `https://${source.url}`;
}

async function backendUrl(provider) {
  const { env, core } = provider;
  const id = required(env, 'VERCEL_BACKEND_PROJECT_ID');
  const project = await provider.project(id);
  core.info(`Looking up the READY backend for ${env.DEPLOY_BRANCH} (${env.DEPLOY_TARGET}).`);
  const source = selectDeployment(
    await provider.deployments(id),
    env.DEPLOY_BRANCH,
    env.DEPLOY_TARGET,
  );
  if (!source) throw new Error('No matching READY backend exists. Run the backend workflow first.');
  core.info(`Selected backend deployment: ${source.uid ?? source.id}.`);
  return deploymentUrl(
    provider,
    source,
    aliasName(project.name, env.DEPLOY_BRANCH, env.DEPLOY_TARGET),
    id,
  );
}

async function plan(provider) {
  const { env, core } = provider;
  const component = required(env, 'COMPONENT');
  if (!['backend', 'frontend'].includes(component)) throw new Error('Unknown application.');
  const projectId = required(env, `VERCEL_${component.toUpperCase()}_PROJECT_ID`);
  const branch = required(env, 'DEPLOY_BRANCH');
  const target = required(env, 'DEPLOY_TARGET');
  if (!['preview', 'production'].includes(target)) throw new Error('Invalid deployment target.');
  const build = required(env, 'BUILD_REQUESTED') === 'true';
  const project = await provider.project(projectId);
  core.info(`Resolving ${component} for branch ${branch} (${target}); build requested: ${build}.`);
  const history = build ? [] : await provider.deployments(projectId);
  const existing = selectDeployment(history, branch, target);
  const production = selectDeployment(history, branch, 'production');
  const mode = resolveMode(build, existing, production);
  const source = mode === 'reuse' ? existing : mode === 'restore' ? production : null;
  const state = {
    component,
    project_id: projectId,
    branch,
    target,
    alias: aliasName(project.name, branch, target),
    mode,
    source,
    runtime: {},
  };
  if (mode === 'reuse') {
    state.url = await deploymentUrl(provider, source, state.alias, projectId);
    await writePrivate(env.STATE_FILE, state);
    core.setOutput('mode', mode);
    core.info(`Existing deployment: ${source.uid ?? source.id} at ${state.url}.`);
    core.info(`Resolved ${component}: reuse (existing preview left untouched).`);
    return;
  }
  core.info(
    mode === 'build'
      ? `Selected a full ${component} build and publication.`
      : `No matching preview exists; restoring production deployment ${source.uid ?? source.id}.`,
  );
  const frontendId = required(env, 'VERCEL_FRONTEND_PROJECT_ID');
  const frontend = await provider.project(frontendId);
  const frontendAlias = aliasName(frontend.name, branch, target);
  if (component === 'backend') {
    const alias = await provider.alias(frontendAlias, frontendId);
    if (target === 'preview' && !alias) {
      // URL reservation only: never invoke frontend CI or build/deploy its code.
      const stable = selectDeployment(await provider.deployments(frontendId), branch, 'production');
      if (!stable)
        throw new Error('Create the initial production frontend before reserving preview URLs.');
      await provider.assign(frontendAlias, frontendId, stable.uid ?? stable.id);
    }
    state.runtime = {
      CORS_ALLOWED_ORIGINS: `https://${frontendAlias}`,
      DATABASE_URL: await provider.connection(await provider.branch(), true),
    };
  } else {
    state.runtime = {
      BACKEND_URL: await backendUrl(provider),
      FRONTEND_URL: `https://${frontendAlias}`,
    };
  }
  if (mode === 'restore') {
    const metadata = source.meta ?? {};
    if (!metadata.rnsArtifactId)
      throw new Error(
        'Production has no retained prebuilt output. Build production once after merge; never silently rebuild unchanged PR source.',
      );
    const artifact = await provider.request(
      'github',
      'GET',
      `/repos/${required(env, 'GITHUB_REPOSITORY')}/actions/artifacts/${encodeURIComponent(metadata.rnsArtifactId)}`,
    );
    if (
      artifact.expired !== false ||
      artifact.name !== metadata.rnsArtifactName ||
      String(artifact.workflow_run?.id) !== String(metadata.rnsArtifactRunId) ||
      String(artifact.workflow_run?.head_repository_id ?? env.GITHUB_REPOSITORY_ID) !==
        required(env, 'GITHUB_REPOSITORY_ID')
    ) {
      throw new Error('Invalid, expired, or foreign production artifact.');
    }
    core.setOutput('artifact_id', metadata.rnsArtifactId);
    core.setOutput('artifact_run_id', metadata.rnsArtifactRunId);
    core.setOutput('artifact_name', metadata.rnsArtifactName);
  }
  await writePrivate(env.STATE_FILE, state);
  core.setOutput('mode', mode);
  core.info(`Resolved ${component}: ${mode}.`);
}

async function publish(provider, exec, state) {
  const { env, core } = provider;
  let id;
  let url;
  if (state.mode === 'reuse') {
    id = state.source.uid ?? state.source.id;
    url = state.url;
    core.info(`Reusing deployment ${id} at ${url}; no publication needed.`);
  } else {
    await injectRuntime('.vercel/output', state.runtime);
    const source = state.source?.meta;
    const metadata = {
      githubDeployment: '1',
      githubCommitRef: state.branch,
      githubCommitSha: required(env, 'GITHUB_SHA'),
      rnsArtifactId:
        state.mode === 'build' ? required(env, 'BUILD_ARTIFACT_ID') : source.rnsArtifactId,
      rnsArtifactRunId:
        state.mode === 'build' ? required(env, 'GITHUB_RUN_ID') : source.rnsArtifactRunId,
      rnsArtifactName:
        state.mode === 'build' ? required(env, 'BUILD_ARTIFACT_NAME') : source.rnsArtifactName,
    };
    const args = [
      'deploy',
      '--prebuilt',
      '--local-config',
      required(env, 'VERCEL_LOCAL_CONFIG'),
      '--environment',
      state.target,
    ];
    for (const [key, value] of Object.entries(metadata)) args.push('--meta', `${key}=${value}`);
    for (const key of Object.keys(state.runtime)) args.push('--env', key);
    const result = await command(exec, 'vercel', args, {
      env: { ...env, ...state.runtime, VERCEL_PROJECT_ID: state.project_id },
      allowFailure: true,
    });
    core.info(provider.sanitize(result.stderr));
    if (result.exitCode) throw new Error('Vercel publication failed; see sanitized CLI output.');
    const hostname = result.stdout.trim().replace(/^https:\/\//, '');
    const deployment = await provider.request(
      'vercel',
      'GET',
      `/v13/deployments/${encodeURIComponent(hostname)}`,
    );
    if (deployment.readyState !== 'READY') throw new Error('The deployment did not reach READY.');
    id = deployment.id;
    await provider.assign(state.alias, state.project_id, id);
    url = `https://${state.alias}`;
    core.info(`Published deployment ${id} at ${url}.`);
  }
  await writePrivate(env.STATE_FILE, { ...state, deployment_id: id, url });
  core.setOutput('url', url);
  core.setOutput('deployment_id', id);
  await core.summary
    .addHeading(`${state.component} deployment`)
    .addRaw(`\n- Target: ${state.target}\n- Mode: ${state.mode}\n- URL: <${url}>\n`, true)
    .write();
}

async function clearBuildEnvironment(directory = '.vercel') {
  for (const name of await fs.readdir(directory)) {
    if (/^\.env\..+\.local$/.test(name)) await fs.writeFile(path.join(directory, name), '');
  }
}

async function run({
  core,
  github,
  exec,
  operation = process.env.DEPLOY_OPERATION,
  env = process.env,
}) {
  const provider = new Providers({ core, github, env });
  const temporary = await fs.mkdtemp(path.join(env.RUNNER_TEMP || os.tmpdir(), 'rns-js-'));
  try {
    if (operation === 'plan') {
      env.STATE_FILE = path.join(required(env, 'RUNNER_TEMP'), 'rns-deployment.json');
      env.ARCHIVE_PATH = path.join(env.RUNNER_TEMP, 'rns-artifact/build-output.tar.gz');
      core.exportVariable('STATE_FILE', env.STATE_FILE);
      core.exportVariable('ARCHIVE_PATH', env.ARCHIVE_PATH);
      await plan(provider);
      return;
    }
    if (operation === 'pull') {
      const args = [
        'pull',
        '--local-config',
        required(env, 'VERCEL_LOCAL_CONFIG'),
        '--yes',
        '--environment',
        required(env, 'DEPLOY_TARGET'),
      ];
      if (env.DEPLOY_TARGET === 'preview')
        args.push('--git-branch', required(env, 'DEPLOY_BRANCH'));
      const result = await command(exec, 'vercel', args, { env, allowFailure: true });
      core.info(provider.sanitize(result.stderr));
      if (result.exitCode) throw new Error('Could not pull Vercel project settings.');
      return;
    }
    if (operation === 'build') {
      if (env.COMPONENT === 'frontend') {
        await packageFrontend({ dist: 'frontend/dist/frontend', output: '.vercel/output' });
        core.info('Packaged the validated Angular SSR build; no Vercel build was run.');
        return;
      }
      await clearBuildEnvironment();
      const result = await command(
        exec,
        'vercel',
        [
          'build',
          '--local-config',
          required(env, 'VERCEL_LOCAL_CONFIG'),
          '--environment',
          required(env, 'DEPLOY_TARGET'),
        ],
        { env: buildEnvironment(env), allowFailure: true },
      );
      core.info(provider.sanitize(result.stdout));
      core.info(provider.sanitize(result.stderr));
      if (result.exitCode) throw new Error('Vercel build failed.');
      return;
    }
    if (operation === 'download') {
      await command(
        exec,
        'gh',
        [
          'run',
          'download',
          required(env, 'SOURCE_RUN'),
          '--repo',
          required(env, 'GITHUB_REPOSITORY'),
          '--name',
          required(env, 'SOURCE_ARTIFACT'),
          '--dir',
          path.join(required(env, 'RUNNER_TEMP'), 'rns-artifact'),
        ],
        { env },
      );
      return;
    }
    const state = JSON.parse(await fs.readFile(required(env, 'STATE_FILE'), 'utf8'));
    if (state.runtime.DATABASE_URL) provider.secret(state.runtime.DATABASE_URL);
    if (operation === 'pack')
      await packOutput({
        source: '.vercel/output',
        archive: required(env, 'ARCHIVE_PATH'),
        component: state.component,
        workspace: env.GITHUB_WORKSPACE,
        temporary,
        exec,
        secrets: [...provider.secrets],
      });
    else if (operation === 'restore')
      await restoreOutput({
        archive: required(env, 'ARCHIVE_PATH'),
        destination: '.vercel/output',
        component: state.component,
        temporary,
        exec,
      });
    else if (operation === 'publish') await publish(provider, exec, state);
    else throw new Error('Unknown deployment operation.');
  } catch (error) {
    throw new Error(provider.sanitize(error.message));
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

module.exports = run;
Object.assign(module.exports, {
  resolveMode,
  deploymentUrl,
  backendUrl,
  plan,
  publish,
  clearBuildEnvironment,
});
