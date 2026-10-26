#!/usr/bin/env bash
# Provider fixtures intentionally isolate their function/env overrides in subshells.
# shellcheck disable=SC2030,SC2031
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TEMP=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/rns-tests.XXXXXX")
trap 'rm -rf -- "$TEMP"' EXIT
export CI_TMP=$TEMP
# shellcheck source=ci/deploy.sh
source "$ROOT/ci/deploy.sh"
passed=0
pass() { passed=$((passed + 1)); printf 'ok %s - %s\n' "$passed" "$1"; }
expect_failure() { if ("$@") > "$TEMP/failure" 2>&1; then die 'Expected a failure, but the operation succeeded.'; fi; }

# Real Git history: the detector receives only a substring and event JSON.
mkdir "$TEMP/repo"
git -C "$TEMP/repo" init -q
git -C "$TEMP/repo" config user.name 'CI fixture'
git -C "$TEMP/repo" config user.email 'fixture@example.invalid'
commit() { git -C "$TEMP/repo" add -A; git -C "$TEMP/repo" -c commit.gpgsign=false commit -qm fixture; }
mkdir -p "$TEMP/repo/backend" "$TEMP/repo/frontend" "$TEMP/repo/database"
printf 'base\n' > "$TEMP/repo/backend/base"
printf 'base\n' > "$TEMP/repo/frontend/base"
printf 'base\n' > "$TEMP/repo/database/base"
commit; base=$(git -C "$TEMP/repo" rev-parse HEAD)
printf 'new\n' > "$TEMP/repo/backend/added file"
commit; backend_head=$(git -C "$TEMP/repo" rev-parse HEAD)
printf 'new\n' > "$TEMP/repo/frontend/added"
commit; frontend_head=$(git -C "$TEMP/repo" rev-parse HEAD)
event() { jq -n --arg before "$1" --arg after "$2" '{before:$before,after:$after}' > "$TEMP/event.json"; }
detect() {
  : > "$TEMP/outputs"
  (cd "$TEMP/repo"; GITHUB_EVENT_PATH="$TEMP/event.json" GITHUB_OUTPUT="$TEMP/outputs" bash "$ROOT/.github/actions/component-changes/detect.sh" "$1")
  grep -Fxq "changed=$2" "$TEMP/outputs"
}
event "$base" "$frontend_head"
detect backend/ true; pass 'whole multi-commit push includes earlier backend change'
detect frontend/ true; pass 'whole push includes newest frontend change'
detect database/ false; pass 'unaffected path is false'
event "$backend_head" "$frontend_head"
detect backend/ false; pass 'latest frontend-only push does not rebuild earlier PR backend changes'
detect 'end/add' true; pass 'input is a substring, not a hard-coded component or prefix'
git -C "$TEMP/repo" rm -q backend/base; commit
deleted=$(git -C "$TEMP/repo" rev-parse HEAD)
event "$frontend_head" "$deleted"; detect backend/ true; pass 'deleted files are detected'
git -C "$TEMP/repo" mv 'backend/added file' frontend/moved; commit
renamed=$(git -C "$TEMP/repo" rev-parse HEAD)
event "$deleted" "$renamed"
detect backend/ true; detect frontend/ true; pass 'both sides of renames are detected'
printf 'new\n' > "$TEMP/repo/backend/line"$'\n''break'; commit
event "$renamed" "$(git -C "$TEMP/repo" rev-parse HEAD)"
detect backend/ true; pass 'NUL-delimited paths preserve newline filenames'
printf '{}\n' > "$TEMP/event.json"
expect_failure detect backend/ false; pass 'missing event fields fail without fallback'

[[ $(resolve_mode false '{"id":"preview"}' '{"id":"production"}') == reuse ]]
pass 'existing READY preview wins before production cloning'
[[ $(resolve_mode false null '{"id":"production"}') == restore ]]
pass 'missing preview restores production output'
[[ $(resolve_mode true '{"id":"preview"}' null) == build ]]
pass 'changed component selects a full build'
expect_failure resolve_mode false null null; pass 'no output never silently builds source'
[[ $(alias_name frontend feature preview) != "$(alias_name frontend other preview)" ]]
[[ $(alias_name frontend feature preview) == "$(alias_name frontend feature preview)" ]]
pass 'preview URLs are stable and branch-isolated'

export STATE_FILE="$TEMP/state.json" GITHUB_OUTPUT="$TEMP/publish-output" GITHUB_STEP_SUMMARY="$TEMP/summary"
jq -n '{mode:"reuse",source:{id:"existing"},url:"https://frontend.test",project_id:"project",alias:"frontend.test",target:"preview",branch:"branch",component:"frontend"}' > "$STATE_FILE"
(
  vercel() { die 'Reuse must not invoke the deployment CLI.'; }
  assign_alias() { die 'Reuse must not change aliases.'; }
  inject_runtime() { die 'Reuse must not rebind runtime configuration.'; }
  publish
)
grep -Fxq 'deployment_id=existing' "$GITHUB_OUTPUT"
pass 'publishing reuse is read-only: no clone, CLI, alias write, or runtime rebind'
(
  api() {
    [[ "$2" == GET ]] || die 'Existing Neon preview must not be created again.'
    printf '{"branches":[{"id":"existing","name":"preview/branch"}]}\n'
  }
  export NEON_PROJECT_ID=project DEPLOY_BRANCH=branch DEPLOY_TARGET=preview
  [[ $(neon_branch true) == existing ]]
)
pass 'existing database preview is also a no-op'

(
  export COMPONENT=backend BUILD_REQUESTED=false DEPLOY_BRANCH=branch DEPLOY_TARGET=preview
  export VERCEL_BACKEND_PROJECT_ID=backend VERCEL_FRONTEND_PROJECT_ID=frontend STATE_FILE="$TEMP/planned.json"
  api() {
    [[ "$1" == vercel && "$2" == GET ]] || die 'Reuse must only read provider metadata.'
    case "$3" in
      /v9/projects/backend) printf '{"id":"backend","name":"backend"}\n' ;;
      /v9/projects/frontend) printf '{"id":"frontend","name":"frontend"}\n' ;;
      /v4/aliases/frontend-*) printf '{"projectId":"frontend","deploymentId":"front"}\n' ;;
      /v4/aliases/backend-*) printf '{"projectId":"backend","deploymentId":"existing"}\n' ;;
      *) die 'Unexpected provider request.' ;;
    esac
  }
  vercel_deployments() { printf '[{"id":"existing","state":"READY","url":"existing.test","meta":{"githubCommitRef":"branch"}}]\n'; }
  neon_branch() { die 'Existing backend preview must not resolve or change its database.'; }
  plan_application > /dev/null
  jq -e '.mode == "reuse" and (.runtime | has("DATABASE_URL") | not)' "$STATE_FILE" >/dev/null
)
pass 'existing backend is found before credentials or production artifacts are resolved'
(
  export COMPONENT=backend BUILD_REQUESTED=false DEPLOY_BRANCH=branch DEPLOY_TARGET=preview
  export VERCEL_BACKEND_PROJECT_ID=backend VERCEL_FRONTEND_PROJECT_ID=frontend STATE_FILE="$TEMP/restored-plan.json"
  export GITHUB_REPOSITORY=owner/repo GITHUB_REPOSITORY_ID=99
  api() {
    [[ "$2" == GET ]] || die 'Existing resource lookup must not write provider state.'
    case "$3" in
      /v9/projects/backend) printf '{"id":"backend","name":"backend"}\n' ;;
      /v9/projects/frontend) printf '{"id":"frontend","name":"frontend"}\n' ;;
      /v4/aliases/frontend-*) printf '{"projectId":"frontend","deploymentId":"front"}\n' ;;
      /repos/owner/repo/actions/artifacts/123) printf '{"expired":false,"name":"compiled","workflow_run":{"id":42,"head_repository_id":99}}\n' ;;
      *) die 'Unexpected provider request.' ;;
    esac
  }
  vercel_deployments() { printf '[{"id":"production","state":"READY","target":"production","meta":{"rnsArtifactId":"123","rnsArtifactRunId":"42","rnsArtifactName":"compiled"}}]\n'; }
  neon_branch() { printf 'preview-db\n'; }
  neon_connection() { printf 'credential-fixture\n'; }
  plan_application > /dev/null
  jq -e '.mode == "restore" and .source.id == "production" and .runtime.DATABASE_URL == "credential-fixture"' "$STATE_FILE" >/dev/null
  [[ $(find "$STATE_FILE" -perm 0600 -print) == "$STATE_FILE" ]]
)
pass 'only a missing preview resolves private credentials and verified production output'
(
  export STATE_FILE="$TEMP/build-plan.json" GITHUB_SHA=fixture VERCEL_LOCAL_CONFIG=vercel.json
  export BUILD_ARTIFACT_ID=123 GITHUB_RUN_ID=42 BUILD_ARTIFACT_NAME=compiled VERCEL_TOKEN=token-fixture
  jq -n '{mode:"build",component:"backend",project_id:"backend",alias:"backend.test",branch:"branch",target:"preview",runtime:{DATABASE_URL:"credential-fixture"}}' > "$STATE_FILE"
  inject_runtime() { :; }
  api() { printf '{"id":"published","readyState":"READY"}\n'; }
  assign_alias() { [[ "$1" == backend.test && "$3" == published ]]; }
  vercel() {
    [[ "$*" != *credential-fixture* && "$*" != *token-fixture* && "$*" == *'--env DATABASE_URL'* ]]
    [[ ${DATABASE_URL:?} == credential-fixture ]]
    printf 'https://published.test\n'
  }
  publish > /dev/null
  jq -e '.deployment_id == "published" and .url == "https://backend.test"' "$STATE_FILE" >/dev/null
)
pass 'publication passes runtime values in environment, not command arguments'

source_dir="$TEMP/work/output"; function_dir="$source_dir/functions/app.func"
mkdir -p "$function_dir" "$TEMP/work/application"
printf '{"version":3}\n' > "$source_dir/config.json"
printf 'private CLI state\n' > "$source_dir/builds.json"
printf 'application\n' > "$TEMP/work/application/main.py"
printf 'vendor\n' > "$TEMP/work/application/dependency.py"
jq -n '{runtime:"python3.14",environment:{DATABASE_URL:"credential-fixture",VERCEL_TOKEN:"token-fixture",PYTHONPATH:"."},filePathMap:{"main.py":"application/main.py","_vendor/dependency.py":"application/dependency.py"}}' > "$function_dir/.vc-config.json"
printf 'private-env\n' > "$function_dir/.env.local"
export GITHUB_WORKSPACE="$TEMP/work" DATABASE_URL=credential-fixture VERCEL_TOKEN=token-fixture
archive="$TEMP/build-output.tar.gz"
pack_output "$source_dir" "$archive" backend
restore_output "$archive" "$TEMP/restored" backend
[[ -f "$TEMP/restored/functions/app.func/main.py" && -f "$TEMP/restored/functions/app.func/_vendor/dependency.py" ]]
[[ ! -e "$TEMP/restored/builds.json" && ! -e "$TEMP/restored/functions/app.func/.env.local" ]]
jq -e '.environment == {PYTHONPATH:"."} and (has("filePathMap") | not)' "$TEMP/restored/functions/app.func/.vc-config.json" >/dev/null
pass 'portable artifacts materialize dependencies and strip credentials/env/CLI state'
expect_failure restore_output "$archive" "$TEMP/wrong" frontend; pass 'wrong application artifact is rejected'
printf 'credential-fixture\n' > "$function_dir/embedded"
expect_failure pack_output "$source_dir" "$archive" backend; pass 'embedded credentials prevent upload'
rm "$function_dir/embedded"
ln -s "$TEMP/outside" "$function_dir/external"
printf 'outside\n' > "$TEMP/outside"
expect_failure pack_output "$source_dir" "$archive" backend; pass 'external build symlinks are rejected'
rm "$function_dir/external"
jq '.filePathMap = {"../escape":"application/main.py"}' "$function_dir/.vc-config.json" > "$TEMP/config"
cp "$TEMP/config" "$function_dir/.vc-config.json"
expect_failure pack_output "$source_dir" "$archive" backend; pass 'mapped destination traversal is rejected'
ln -s / "$TEMP/restored/functions/app.func/link"
tar -czf "$TEMP/unsafe.tar.gz" -C "$TEMP/restored" functions
expect_failure restore_output "$TEMP/unsafe.tar.gz" "$TEMP/unsafe" backend; pass 'unsafe archive members are rejected before extraction'

printf '<script id="ng-state" type="application/json">{"backend-api-url":"https://backend.test/","123":{"s":200,"u":"https://backend.test/","b":{"Hello":"World"}}}</script>' > "$TEMP/ssr.html"
verify_ssr_state "$TEMP/ssr.html" https://backend.test
pass 'actual HTTP response state is required for SSR success'
printf '<script id="ng-state" type="application/json">{"backend-api-url":"https://backend.test/"}</script>' > "$TEMP/ssr.html"
expect_failure verify_ssr_state "$TEMP/ssr.html" https://backend.test; pass 'transferring only the URL is rejected'
[[ $(printf '%s\n' '{"data":{"logs":[{"message":"nested error"}]}}' | jq -r '(.data // .) | (.logs // [.])[] | .message // empty') == 'nested error' ]]
pass 'nested Vercel runtime messages are read'
[[ $(sanitize 'token-fixture postgresql://user:password@host/db') != *token-fixture* ]]
[[ $(sanitize 'postgresql://user:password@host/db') != *password* ]]
pass 'runtime diagnostics redact tokens and database URLs'

[[ $(grep -l 'uses: \$/\.github/actions/component-changes' "$ROOT"/.github/workflows/reusable-*.yml | wc -l | tr -d ' ') == 3 ]]
[[ $(awk '/^jobs:/{jobs=1;next} jobs && /^  [a-z]+:/{print $1}' "$ROOT/.github/workflows/automatic.yml" | tr '\n' ' ') == 'database: backend: frontend: ' ]]
if grep -qE 'uses:.*reusable-(database|backend|frontend)' "$ROOT"/.github/workflows/reusable-*.yml; then die 'Nested application workflow call found.'; fi
if grep -R -nE 'python3|ci/deploy\.py|unittest' "$ROOT/.github"; then die 'Python CI/CD glue found.'; fi
pass 'three detector calls, exactly three automatic jobs, no nested workflows or Python glue'
printf '%s Bash CI/CD checks passed.\n' "$passed"
