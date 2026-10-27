function commandEnvironment(env = process.env) {
  // github-script's token is an action input, not just GITHUB_TOKEN. Do not
  // forward action inputs to package installers or application subprocesses.
  return Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith('INPUT_')));
}

async function command(
  exec,
  program,
  args,
  { env = process.env, input, allowFailure = false } = {},
) {
  const result = await exec.getExecOutput(program, args, {
    env: commandEnvironment(env),
    input,
    silent: true,
    ignoreReturnCode: true,
  });
  if (result.exitCode && !allowFailure)
    throw new Error(`${program} command failed (exit ${result.exitCode}).`);
  return result;
}

function buildEnvironment(env = process.env) {
  const result = commandEnvironment(env);
  for (const name of ['NEON_API_KEY', 'GITHUB_TOKEN', 'GH_TOKEN', 'DATABASE_URL'])
    delete result[name];
  return result;
}

module.exports = { command, commandEnvironment, buildEnvironment };
