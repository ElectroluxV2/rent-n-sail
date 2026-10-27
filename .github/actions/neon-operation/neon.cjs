const { createProviders } = require('../_shared/providers.cjs');

module.exports = async ({ core }) => {
  const providers = createProviders({ core });
  switch (process.env.NEON_OPERATION) {
    case 'database-plan':
      core.setOutput('parent_branch_id', await providers.getProductionDatabase());
      break;
    case 'database-branch':
      core.setOutput('branch_id', await providers.getDatabasePreviewFor({ create: true }));
      break;
    case 'database-env':
      // This stays in the consuming job, never in action/workflow outputs or
      // github-script's automatic result output.
      core.exportVariable(
        'DATABASE_URL',
        await providers.getDatabaseConnectionFor({
          branchId: process.env.NEON_BRANCH_ID,
          pooled: false,
        }),
      );
      break;
    default:
      throw new Error('Unknown Neon operation.');
  }
};
