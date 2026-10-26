#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
CI_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=.github/actions/_shared/providers.sh
source "$CI_DIR/../_shared/providers.sh"
# shellcheck source=.github/actions/vercel-prebuilt-deploy/artifacts.sh
source "$CI_DIR/artifacts.sh"

resolve_mode() {
  # A no-build run is deliberately a no-op when its READY preview already exists.
  # Do not compare source/config fingerprints or replace it with production.
  if [[ "$1" == true ]]; then printf 'build\n'
  elif [[ "$2" != null ]]; then printf 'reuse\n'
  elif [[ "$3" != null ]]; then printf 'restore\n'
  else die 'No production output exists. Run this application with build=true once.'; fi
}
deployment_url() {
  local source=$1 alias=$2 project=$3 current id
  id=$(jq -r '.uid // .id' <<< "$source"); current=$(checked_alias "$alias" "$project")
  if [[ $(jq -r '.deploymentId // empty' <<< "$current") == "$id" ]]; then printf 'https://%s\n' "$alias"
  else jq -er '.url | if startswith("https://") then . else "https://" + . end' <<< "$source"; fi
}
resolve_backend_url() {
  required VERCEL_BACKEND_PROJECT_ID
  local project source hostname
  project=$(api vercel GET "/v9/projects/$(uri "$VERCEL_BACKEND_PROJECT_ID")")
  printf 'Looking up the READY backend for %s (%s).\n' "$DEPLOY_BRANCH" "$DEPLOY_TARGET" >&2
  source=$(vercel_deployments "$VERCEL_BACKEND_PROJECT_ID" | select_deployment "$DEPLOY_BRANCH" "$DEPLOY_TARGET")
  [[ "$source" != null ]] || die 'No matching READY backend exists. Run the backend workflow first.'
  hostname=$(alias_name "$(jq -r '.name' <<< "$project")" "$DEPLOY_BRANCH" "$DEPLOY_TARGET")
  printf 'Selected backend deployment: %s.\n' "$(jq -r '.uid // .id' <<< "$source")" >&2
  deployment_url "$source" "$hostname" "$VERCEL_BACKEND_PROJECT_ID"
}
plan_application() {
  local project_id project frontend hostname frontend_alias history='[]' existing=null production=null source mode runtime alias_record stable branch artifact id
  case ${COMPONENT:?} in
    backend) required VERCEL_BACKEND_PROJECT_ID; project_id=$VERCEL_BACKEND_PROJECT_ID ;;
    frontend) required VERCEL_FRONTEND_PROJECT_ID; project_id=$VERCEL_FRONTEND_PROJECT_ID ;;
    *) die 'Unknown application.' ;;
  esac
  project=$(api vercel GET "/v9/projects/$(uri "$project_id")")
  printf 'Resolving %s for branch %s (%s); build requested: %s.\n' "$COMPONENT" "$DEPLOY_BRANCH" "$DEPLOY_TARGET" "$BUILD_REQUESTED"
  hostname=$(alias_name "$(jq -r '.name' <<< "$project")" "${DEPLOY_BRANCH:?}" "${DEPLOY_TARGET:?}")
  if [[ ${BUILD_REQUESTED:?} != true ]]; then
    history=$(vercel_deployments "$project_id")
    existing=$(select_deployment "$DEPLOY_BRANCH" "$DEPLOY_TARGET" <<< "$history")
    production=$(select_deployment "$DEPLOY_BRANCH" production <<< "$history")
  fi
  mode=$(resolve_mode "$BUILD_REQUESTED" "$existing" "$production")
  source=null
  [[ "$mode" != reuse ]] || source=$existing
  [[ "$mode" != restore ]] || source=$production
  jq -n --arg component "$COMPONENT" --arg project "$project_id" --arg branch "$DEPLOY_BRANCH" \
    --arg target "$DEPLOY_TARGET" --arg alias "$hostname" --arg mode "$mode" --argjson source "$source" \
    '{component:$component,project_id:$project,branch:$branch,target:$target,alias:$alias,mode:$mode,source:$source,runtime:{}}' |
    private_json "${STATE_FILE:?}"
  # Existing preview: report it and stop. No other application, dependency,
  # runtime configuration, toolchain, or deployment needs to be touched.
  if [[ "$mode" == reuse ]]; then
    local url; url=$(deployment_url "$source" "$hostname" "$project_id")
    jq --arg url "$url" '. + {url:$url}' "$STATE_FILE" | private_json "$STATE_FILE.new"; mv "$STATE_FILE.new" "$STATE_FILE"
    out mode reuse
    printf 'Existing deployment: %s at %s.\n' "$(jq -r '.uid // .id' <<< "$source")" "$url"
    printf 'Resolved %s: reuse (existing preview left untouched).\n' "$COMPONENT"
    return
  fi
  if [[ "$mode" == build ]]; then
    printf 'Selected a full %s build and publication.\n' "$COMPONENT"
  else
    printf 'No matching preview exists; restoring production deployment %s.\n' "$(jq -r '.uid // .id' <<< "$source")"
  fi
  frontend=$(api vercel GET "/v9/projects/$(uri "${VERCEL_FRONTEND_PROJECT_ID:?}")")
  frontend_alias=$(alias_name "$(jq -r '.name' <<< "$frontend")" "$DEPLOY_BRANCH" "$DEPLOY_TARGET")
  runtime=$(mktemp "$CI_TMP/runtime.XXXXXX")
  if [[ "$COMPONENT" == backend ]]; then
    alias_record=$(checked_alias "$frontend_alias" "$VERCEL_FRONTEND_PROJECT_ID")
    if [[ "$DEPLOY_TARGET" == preview && "$alias_record" == null ]]; then
      # Reserve the public hostname before trusting it as a CORS origin. This
      # provider URL reservation never invokes frontend CI or builds/deploys code.
      stable=$(vercel_deployments "$VERCEL_FRONTEND_PROJECT_ID" | select_deployment "$DEPLOY_BRANCH" production)
      [[ "$stable" != null ]] || die 'Create the initial production frontend before reserving preview URLs.'
      assign_alias "$frontend_alias" "$VERCEL_FRONTEND_PROJECT_ID" "$(jq -r '.uid // .id' <<< "$stable")"
    fi
    jq -n --arg origin "https://$frontend_alias" '{CORS_ALLOWED_ORIGINS:$origin}' > "$runtime"
    branch=$(neon_branch false)
    DATABASE_URL=$(neon_connection "$branch" true); export DATABASE_URL
    jq '. + {DATABASE_URL:env.DATABASE_URL}' "$runtime" | private_json "$runtime.new"
    mv "$runtime.new" "$runtime"
  else
    local backend; backend=$(resolve_backend_url)
    jq -n --arg backend "$backend" --arg frontend "https://$frontend_alias" '{BACKEND_URL:$backend,FRONTEND_URL:$frontend}' > "$runtime"
  fi
  jq --slurpfile runtime "$runtime" '.runtime=$runtime[0]' "$STATE_FILE" | private_json "$STATE_FILE.new"
  mv "$STATE_FILE.new" "$STATE_FILE"
  if [[ "$mode" == restore ]]; then
    id=$(jq -r '.meta.rnsArtifactId // empty' <<< "$source")
    [[ -n "$id" ]] || die 'Production has no retained prebuilt output. Build production once after merge; never silently rebuild unchanged PR source.'
    artifact=$(api github GET "/repos/${GITHUB_REPOSITORY:?}/actions/artifacts/$(uri "$id")")
    jq -e --argjson source "$source" --arg repo "${GITHUB_REPOSITORY_ID:?}" '
      .expired == false and .name == $source.meta.rnsArtifactName
      and (.workflow_run.id | tostring) == ($source.meta.rnsArtifactRunId | tostring)
      and ((.workflow_run.head_repository_id // $repo | tostring) == $repo)' <<< "$artifact" >/dev/null || die 'Invalid, expired, or foreign production artifact.'
    out artifact_id "$id"
    out artifact_run_id "$(jq -r '.meta.rnsArtifactRunId' <<< "$source")"
    out artifact_name "$(jq -r '.meta.rnsArtifactName' <<< "$source")"
  fi
  out mode "$mode"
  printf 'Resolved %s: %s.\n' "$COMPONENT" "$mode"
}
publish() {
  local mode project alias target branch component runtime id url artifact_id artifact_run artifact_name metadata key value result
  mode=$(jq -r '.mode' "$STATE_FILE"); project=$(jq -r '.project_id' "$STATE_FILE")
  alias=$(jq -r '.alias' "$STATE_FILE"); target=$(jq -r '.target' "$STATE_FILE")
  branch=$(jq -r '.branch' "$STATE_FILE"); component=$(jq -r '.component' "$STATE_FILE")
  if [[ "$mode" == reuse ]]; then
    id=$(jq -r '.source.uid // .source.id' "$STATE_FILE"); url=$(jq -r '.url' "$STATE_FILE")
    printf 'Reusing deployment %s at %s; no publication needed.\n' "$id" "$url"
  else
    runtime=$(mktemp "$CI_TMP/runtime.XXXXXX"); jq '.runtime' "$STATE_FILE" > "$runtime"
    inject_runtime .vercel/output "$runtime"
    if [[ "$mode" == build ]]; then
      required BUILD_ARTIFACT_ID; required GITHUB_RUN_ID; required BUILD_ARTIFACT_NAME
      artifact_id=$BUILD_ARTIFACT_ID; artifact_run=$GITHUB_RUN_ID; artifact_name=$BUILD_ARTIFACT_NAME
    else
      artifact_id=$(jq -r '.source.meta.rnsArtifactId' "$STATE_FILE")
      artifact_run=$(jq -r '.source.meta.rnsArtifactRunId' "$STATE_FILE")
      artifact_name=$(jq -r '.source.meta.rnsArtifactName' "$STATE_FILE")
    fi
    metadata=$(jq -cn --arg branch "$branch" --arg sha "${GITHUB_SHA:?}" --arg id "$artifact_id" \
      --arg run "$artifact_run" --arg name "$artifact_name" \
      '{githubDeployment:"1",githubCommitRef:$branch,githubCommitSha:$sha,rnsArtifactId:$id,rnsArtifactRunId:$run,rnsArtifactName:$name}')
    local args=(deploy --prebuilt --local-config "${VERCEL_LOCAL_CONFIG:?}" --environment "$target")
    while IFS= read -r key; do args+=(--meta "$key=$(jq -r --arg key "$key" '.[$key]' <<< "$metadata")"); done < <(jq -r 'keys[]' <<< "$metadata")
    while IFS= read -r key; do
      value=$(jq -r --arg key "$key" '.[$key]' "$runtime")
      export "$key=$value"; args+=(--env "$key")
    done < <(jq -r 'keys[]' "$runtime")
    export VERCEL_PROJECT_ID=$project
    result=0; vercel "${args[@]}" > "$CI_TMP/url" 2> "$CI_TMP/deploy.log" || result=$?
    sanitize "$(cat "$CI_TMP/deploy.log")"
    [[ "$result" == 0 ]] || die 'Vercel publication failed; see sanitized CLI output.'
    url=$(tr -d '\r\n' < "$CI_TMP/url"); url=${url#https://}
    local deployment; deployment=$(api vercel GET "/v13/deployments/$(uri "$url")")
    [[ $(jq -r '.readyState' <<< "$deployment") == READY ]] || die 'The deployment did not reach READY.'
    id=$(jq -r '.id' <<< "$deployment")
    assign_alias "$alias" "$project" "$id"; url="https://$alias"
    printf 'Published deployment %s at %s.\n' "$id" "$url"
  fi
  jq --arg id "$id" --arg url "$url" '. + {deployment_id:$id,url:$url}' "$STATE_FILE" | private_json "$STATE_FILE.new"
  mv "$STATE_FILE.new" "$STATE_FILE"
  out url "$url"; out deployment_id "$id"
  if [[ -n ${GITHUB_STEP_SUMMARY:-} ]]; then
    printf '## %s deployment\n\n- Target: %s\n- Mode: %s\n- URL: <%s>\n' "$component" "$target" "$mode" "$url" >> "$GITHUB_STEP_SUMMARY"
  fi
}
main() {
  CI_TMP=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/rns-ci.XXXXXX")
  trap 'rm -rf -- "$CI_TMP"' EXIT
  trap 'printf "::error title=CI/CD failed::Bash deployment operation failed at line %s.\n" "$LINENO" >&2' ERR
  case ${1:-} in
    plan) plan_application ;;
    build-env)
      local file; for file in .vercel/.env.*.local; do [[ ! -f "$file" ]] || : > "$file"; done
      ;;
    pack)
      DATABASE_URL=$(jq -r '.runtime.DATABASE_URL // empty' "${STATE_FILE:?}"); export DATABASE_URL
      pack_output .vercel/output "${ARCHIVE_PATH:?}" "$(jq -r '.component' "$STATE_FILE")"
      ;;
    restore) restore_output "${ARCHIVE_PATH:?}" .vercel/output "$(jq -r '.component' "${STATE_FILE:?}")" ;;
    publish) publish ;;
    *) die 'Unknown deployment operation.' ;;
  esac
}
if [[ ${BASH_SOURCE[0]} == "$0" ]]; then main "$@"; fi
