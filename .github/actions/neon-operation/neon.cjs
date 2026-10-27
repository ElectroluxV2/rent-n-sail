const { Providers, required } = require('../_shared/providers.cjs');

module.exports = async ({ core }) => {
  const provider = new Providers({ core });
  switch (process.env.NEON_OPERATION) {
    case 'database-plan':
      core.setOutput('parent_branch_id', await provider.parent());
      break;
    case 'database-branch':
      core.setOutput('branch_id', await provider.branch(true));
      break;
    case 'database-env':
      // This stays in the consuming job, never in action/workflow outputs or
      // github-script's automatic result output.
      core.exportVariable(
        'DATABASE_URL',
        await provider.connection(required(process.env, 'NEON_BRANCH_ID'), false),
      );
      break;
    default:
      throw new Error('Unknown Neon operation.');
  }
};
