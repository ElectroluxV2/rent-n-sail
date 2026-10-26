#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
CI_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=ci/lib.sh
source "$CI_DIR/lib.sh"
# shellcheck source=ci/artifacts.sh
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
  source=$(vercel_deployments "$VERCEL_BACKEND_PROJECT_ID" | select_deployment "$DEPLOY_BRANCH" "$DEPLOY_TARGET")
  [[ "$source" != null ]] || die 'No matching READY backend exists. Run the backend workflow first.'
  hostname=$(alias_name "$(jq -r '.name' <<< "$project")" "$DEPLOY_BRANCH" "$DEPLOY_TARGET")
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
  # Resolve only public URL metadata on reuse; do not rotate credentials, build,
  # clone, rebind, or assign aliases to an already-existing preview.
  frontend=$(api vercel GET "/v9/projects/$(uri "${VERCEL_FRONTEND_PROJECT_ID:?}")")
  frontend_alias=$(alias_name "$(jq -r '.name' <<< "$frontend")" "$DEPLOY_BRANCH" "$DEPLOY_TARGET")
  runtime=$(mktemp "$CI_TMP/runtime.XXXXXX")
  if [[ "$COMPONENT" == backend ]]; then
    alias_record=$(checked_alias "$frontend_alias" "$VERCEL_FRONTEND_PROJECT_ID")
    if [[ "$mode" != reuse && "$DEPLOY_TARGET" == preview && "$alias_record" == null ]]; then
      # Reserve the public hostname before trusting it as a CORS origin. This
      # provider URL reservation never invokes frontend CI or builds/deploys code.
      stable=$(vercel_deployments "$VERCEL_FRONTEND_PROJECT_ID" | select_deployment "$DEPLOY_BRANCH" production)
      [[ "$stable" != null ]] || die 'Create the initial production frontend before reserving preview URLs.'
      assign_alias "$frontend_alias" "$VERCEL_FRONTEND_PROJECT_ID" "$(jq -r '.uid // .id' <<< "$stable")"
    fi
    jq -n --arg origin "https://$frontend_alias" '{CORS_ALLOWED_ORIGINS:$origin}' > "$runtime"
    if [[ "$mode" != reuse ]]; then
      branch=$(neon_branch false)
      DATABASE_URL=$(neon_connection "$branch" true); export DATABASE_URL
      jq '. + {DATABASE_URL:env.DATABASE_URL}' "$runtime" | private_json "$runtime.new"
      mv "$runtime.new" "$runtime"
    fi
  else
    local backend; backend=$(resolve_backend_url)
    jq -n --arg backend "$backend" --arg frontend "https://$frontend_alias" '{BACKEND_URL:$backend,FRONTEND_URL:$frontend}' > "$runtime"
  fi
  jq -n --arg component "$COMPONENT" --arg project "$project_id" --arg branch "$DEPLOY_BRANCH" \
    --arg target "$DEPLOY_TARGET" --arg alias "$hostname" --arg mode "$mode" \
    --argjson source "$source" --slurpfile runtime "$runtime" \
    '{component:$component,project_id:$project,branch:$branch,target:$target,alias:$alias,mode:$mode,source:$source,runtime:$runtime[0]}' |
    private_json "${STATE_FILE:?}"
  if [[ "$mode" == reuse ]]; then
    local url; url=$(deployment_url "$source" "$hostname" "$project_id")
    jq --arg url "$url" '. + {url:$url}' "$STATE_FILE" | private_json "$STATE_FILE.new"; mv "$STATE_FILE.new" "$STATE_FILE"
  elif [[ "$mode" == restore ]]; then
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
  fi
  jq --arg id "$id" --arg url "$url" '. + {deployment_id:$id,url:$url}' "$STATE_FILE" | private_json "$STATE_FILE.new"
  mv "$STATE_FILE.new" "$STATE_FILE"
  out url "$url"; out deployment_id "$id"
  if [[ -n ${GITHUB_STEP_SUMMARY:-} ]]; then
    printf '## %s deployment\n\n- Target: %s\n- Mode: %s\n- URL: <%s>\n' "$component" "$target" "$mode" "$url" >> "$GITHUB_STEP_SUMMARY"
  fi
}
header_value() {
  awk -v key="$1" 'tolower(substr($0,1,length(key)+1)) == key ":" {value=substr($0,length(key)+2); sub(/^[ \t]+/,"",value); sub(/\r$/, "", value)} END {print value}' "$2"
}
verify_ssr_state() {
  local expected=${2%/}/
  jq -Rse --arg url "$expected" '
    [scan("<script\\b(?=[^>]*\\btype=\"application/json\")(?=[^>]*\\bid=\"[^\"]*-state\")[^>]*>(.*?)</script>";"s") | .[0] | fromjson]
    | any(.[]; .["backend-api-url"] == $url and any(.[]; type == "object" and .s == 200 and .u == $url and (.b.Hello | type) == "string"))' "$1" >/dev/null || die 'Angular SSR did not transfer a successful HttpClient response from the backend root URL.'
}
runtime_diagnostics() {
  local url project id logs
  url=$(jq -r '.url' "$STATE_FILE"); project=$(jq -r '.project_id' "$STATE_FILE"); id=$(jq -r '.deployment_id' "$STATE_FILE")
  if [[ $(jq -r '.component' "$STATE_FILE") == backend ]]; then
    if VERCEL_PROJECT_ID=$project vercel curl "$url/health" -- --fail --silent --show-error --max-time 30 >/dev/null 2>&1; then
      printf 'Diagnostic health probe: healthy.\n'
    else printf 'Diagnostic health probe: failed.\n'; fi
  fi
  if VERCEL_PROJECT_ID=$project vercel logs --project "$project" --deployment "$id" --since 10m --limit 40 --json > "$CI_TMP/logs" 2> "$CI_TMP/log-errors"; then
    logs=$(jq -r '(.data // .) | (.logs // [.])[] | .message // empty' "$CI_TMP/logs")
    sanitize "${logs:0:12000}"
  else sanitize "$(cat "$CI_TMP/log-errors")"; fi
}
verify_browser_wiring() {
  local frontend backend url status method headers="$CI_TMP/browser-headers" body="$CI_TMP/browser-body"
  frontend=$(jq -r '.runtime.FRONTEND_URL' "$STATE_FILE"); backend=$(jq -r '.runtime.BACKEND_URL' "$STATE_FILE"); backend=${backend%/}/
  for method in GET OPTIONS; do
    local args=(--disable --silent --show-error --max-time 30 --request "$method" --header "Origin: $frontend" --dump-header "$headers" --output "$body" --write-out '%{http_code}')
    [[ "$method" != OPTIONS ]] || args+=(--header 'Access-Control-Request-Method: GET' --header 'Access-Control-Request-Headers: Content-Type')
    status=$(env -u VERCEL_TOKEN -u NEON_API_KEY -u GITHUB_TOKEN -u GH_TOKEN curl "${args[@]}" "$backend") || die 'Anonymous browser API network request failed.'
    if [[ "$status" != 200 ]]; then
      [[ $(header_value location "$headers") != https://vercel.com/* ]] || die 'Browser API access is blocked by Vercel Deployment Protection before CORS.'
      die "Anonymous backend $method verification failed (HTTP $status)."
    fi
    [[ $(header_value access-control-allow-origin "$headers") == "$frontend" ]] || die 'Browser CORS does not allow the exact frontend origin.'
    if [[ "$method" == GET ]]; then
      jq -e 'type == "object" and (.Hello | type) == "string"' "$body" >/dev/null || die 'The browser API root did not return the expected JSON.'
    else
      header_value access-control-allow-methods "$headers" | jq -Re 'split(",") | any(.[]; gsub("^ +| +$";"") == "GET")' >/dev/null || die 'Browser preflight did not allow GET.'
      header_value access-control-allow-headers "$headers" | jq -Re 'ascii_downcase | split(",") | any(.[]; gsub("^ +| +$";"") == "content-type")' >/dev/null || die 'Browser preflight did not allow Content-Type.'
    fi
  done
  printf 'Verified anonymous backend root and exact browser GET/preflight CORS.\n'
  url=$(jq -r '.url' "$STATE_FILE")
  VERCEL_PROJECT_ID=$(jq -r '.project_id' "$STATE_FILE") vercel curl "${url%/}/" -- --fail --silent --show-error --max-time 30 > "$CI_TMP/ssr.html" 2> "$CI_TMP/ssr-errors" || die 'Could not retrieve frontend SSR output.'
  verify_ssr_state "$CI_TMP/ssr.html" "$backend"
  printf 'Verified deployed Angular SSR HttpClient transfer state.\n'
}
smoke() {
  local component url project origin path
  component=$(jq -r '.component' "$STATE_FILE"); url=$(jq -r '.url' "$STATE_FILE"); project=$(jq -r '.project_id' "$STATE_FILE")
  path=/runtime-config.json; [[ "$component" != backend ]] || path=/boats
  local args=(curl "$url$path" -- --fail --silent --show-error --max-time 30 --dump-header "$CI_TMP/headers")
  if [[ "$component" == backend ]]; then origin=$(jq -r '.runtime.CORS_ALLOWED_ORIGINS' "$STATE_FILE"); args+=(-H "Origin: $origin"); fi
  if ! VERCEL_PROJECT_ID=$project vercel "${args[@]}" > "$CI_TMP/body" 2> "$CI_TMP/errors"; then
    sanitize "$(cat "$CI_TMP/errors")"; runtime_diagnostics; die 'Authenticated application HTTP verification failed.'
  fi
  if [[ "$component" == backend ]]; then
    jq -e 'type == "array" and all(.[]; type == "object" and has("id") and has("name") and has("daily_rate"))' "$CI_TMP/body" >/dev/null || die 'The backend did not return migrated inventory.'
    [[ $(header_value access-control-allow-origin "$CI_TMP/headers") == "$origin" ]] || die 'The backend did not allow the exact frontend origin.'
    printf 'Verified live backend inventory (%s rows) and explicit CORS.\n' "$(jq length "$CI_TMP/body")"
  else
    jq -e --slurpfile state "$STATE_FILE" '.backendUrl == $state[0].runtime.BACKEND_URL' "$CI_TMP/body" >/dev/null || die 'Frontend runtime configuration does not match the resolved backend.'
    printf 'Verified frontend runtime configuration.\n'; verify_browser_wiring
  fi
}
main() {
  CI_TMP=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/rns-ci.XXXXXX")
  trap 'rm -rf -- "$CI_TMP"' EXIT
  trap 'printf "::error title=CI/CD failed::Bash deployment operation failed at line %s.\n" "$LINENO" >&2' ERR
  case ${1:-} in
    plan) plan_application ;;
    database-plan) out parent_branch_id "$(neon_parent)" ;;
    database-branch) out branch_id "$(neon_branch true)" ;;
    database-env)
      local connection; connection=$(neon_connection "${NEON_BRANCH_ID:?}" false)
      printf 'DATABASE_URL=%s\n' "$connection" >> "${GITHUB_ENV:?}"
      ;;
    build-env)
      local file; for file in .vercel/.env.*.local; do [[ ! -f "$file" ]] || : > "$file"; done
      ;;
    pack)
      DATABASE_URL=$(jq -r '.runtime.DATABASE_URL // empty' "${STATE_FILE:?}"); export DATABASE_URL
      pack_output .vercel/output "${ARCHIVE_PATH:?}" "$(jq -r '.component' "$STATE_FILE")"
      ;;
    restore) restore_output "${ARCHIVE_PATH:?}" .vercel/output "$(jq -r '.component' "${STATE_FILE:?}")" ;;
    publish) publish ;;
    smoke) smoke ;;
    *) die 'Unknown deployment operation.' ;;
  esac
}
if [[ ${BASH_SOURCE[0]} == "$0" ]]; then main "$@"; fi
