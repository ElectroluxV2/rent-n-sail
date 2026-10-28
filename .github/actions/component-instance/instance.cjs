const { createProviders } = require('../_shared/providers.cjs');

// The operations below use only these names; components differ only in the provider helpers behind them.
function componentFor({ env, providers }) {
  if (env.COMPONENT === 'database')
    return {
      // Migrations change the instance in place, so an update needs one first.
      versioned: false,
      findInstance: providers.findDatabaseBranch,
      forkInstance: providers.forkDatabaseBranch,
      deletePreviewsExcept: providers.deleteDatabaseBranchesExcept,
      resolveSettings: providers.getDatabaseSettings,
    };
  const frontend = env.COMPONENT === 'frontend';
  const resolveSettings = frontend
    ? providers.getFrontendServiceSettings
    : providers.getBackendServiceSettings;
  return {
    // Every release publishes a new version, so an update needs no instance first.
    versioned: true,
    findInstance: providers.findServiceDeployment,
    forkInstance: async () => providers.forkServiceDeployment(await resolveSettings()),
    deletePreviewsExcept: providers.deleteServiceDeploymentsExcept,
    resolveSettings,
    pullConfig: providers.pullServiceConfig,
    packageVersion: frontend
      ? providers.packageFrontendServiceOutput
      : providers.buildServiceOutput,
    releaseUpdate: providers.publishServiceDeployment,
  };
}

// Later steps, including the report, read the instance from the job environment.
function record(core, instance, result) {
  core.exportVariable('INSTANCE_ID', instance.id);
  core.exportVariable('INSTANCE_ADDRESS', instance.address);
  if (result) core.exportVariable('INSTANCE_RESULT', result);
}

async function summarize(core, env, lines) {
  const list = lines.map(([name, value]) => `- ${name}: ${value}`).join('\n');
  await core.summary
    .addRaw(`### ${env.COMPONENT} ${env.DEPLOY_TARGET} for \`${env.DEPLOY_BRANCH}\`\n\n${list}\n`)
    .write();
}

// A preview lives while its Git branch has an open pull request, and through a run that deploys it.
// A failed cleanup only warns, so it never blocks a release; the next ensure retries it.
async function deleteStalePreviews({ core, env, github, context, component }) {
  try {
    const pulls = await github.paginate(github.rest.pulls.list, {
      ...context.repo,
      state: 'open',
      per_page: 100,
    });
    const kept = [...new Set([env.DEPLOY_BRANCH, ...pulls.map((pull) => pull.head.ref)])];
    core.info(`Keeping the previews of ${kept.join(', ')}.`);
    await component.deletePreviewsExcept(kept);
  } catch (error) {
    core.warning(`Stale previews remain: ${error.message}`);
  }
}

const operations = {
  async ensure({ core, env, github, context, component }) {
    await deleteStalePreviews({ core, env, github, context, component });
    const found = await component.findInstance();
    if (found) {
      core.info(`Found ${found.id} at ${found.address}.`);
      return record(core, found, 'reuse');
    }
    if (env.BUILD_NEEDED === 'true' && component.versioned)
      return core.info(`No ${env.DEPLOY_TARGET} instance yet; the release creates it.`);
    const fork = await component.forkInstance();
    core.info(`Forked ${fork.id} at ${fork.address}.`);
    record(core, fork, 'fork');
  },
  pull: ({ component }) => component.pullConfig(),
  package: ({ component }) => component.packageVersion(),
  async settings({ core, component }) {
    const settings = await component.resolveSettings();
    // Values stay in the job environment; only their names reach logs and command arguments.
    for (const [name, value] of Object.entries(settings)) core.exportVariable(name, value);
    core.exportVariable('INSTANCE_SETTINGS', Object.keys(settings).join(' '));
  },
  async release({ core, env, component }) {
    const released = await component.releaseUpdate(env.INSTANCE_SETTINGS.split(' '));
    core.info(`Released ${released.id} at ${released.address}.`);
    record(core, released);
  },
  async report({ core, env }) {
    let result = env.INSTANCE_RESULT;
    if (env.BUILD_NEEDED === 'true') result = result === 'fork' ? 'fork+update' : 'update';
    const { INSTANCE_ID: id, INSTANCE_ADDRESS: address } = env;
    core.info(
      `${env.COMPONENT} ${env.DEPLOY_TARGET} for ${env.DEPLOY_BRANCH}: ${result} ${id} at ${address}`,
    );
    core.setOutput('instance_id', id);
    core.setOutput('address', address);
    core.setOutput('result', result);
    await summarize(core, env, [
      ['Result', result],
      ['Instance', `\`${id}\``],
      ['Address', address],
    ]);
  },
};

module.exports = async ({ core, exec, github, context, env = process.env }) => {
  const operation = env.INSTANCE_OPERATION;
  try {
    const providers = createProviders({ core, exec, env });
    const component = componentFor({ env, providers });
    await operations[operation]({ core, env, github, context, component });
  } catch (error) {
    await summarize(core, env, [
      ['Result', `❌ ${operation} failed`],
      ['Error', error.message],
    ]);
    throw error;
  }
};
