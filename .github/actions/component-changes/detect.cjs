const { commandEnvironment } = require('../_shared/commands.cjs');

module.exports = async ({ github, context, core, exec }) => {
  const { before, after } = context.payload;
  const searched = process.env.CHECK_PATH;
  if (!before || !after || !searched)
    throw new Error('before, after, and the searched path are required.');
  const { data } = await github.request('GET /repos/{owner}/{repo}/compare/{basehead}', {
    ...context.repo,
    basehead: `${before}...${after}`,
  });
  if (!['ahead', 'identical'].includes(data.status))
    throw new Error('Expected a forward commit comparison.');
  if (!Array.isArray(data.files)) throw new Error('GitHub did not return changed-file metadata.');
  const paths = [
    ...new Set(
      data.files.flatMap((file) => [file.filename, file.previous_filename].filter(Boolean)),
    ),
  ].sort();
  core.info(`Searched path: ${JSON.stringify(searched)}`);
  core.info('Changed paths:');
  await exec.exec('jq', ['-C', '.'], {
    input: `${JSON.stringify(paths)}\n`,
    env: commandEnvironment(),
  });
  const capped = data.files.length >= 300;
  if (capped)
    core.info('GitHub comparison reached the 300-file cap; assuming the searched path changed.');
  const changed = capped || paths.some((filename) => filename.includes(searched));
  core.info(`Match: ${changed}`);
  core.setOutput('changed', changed);
};
