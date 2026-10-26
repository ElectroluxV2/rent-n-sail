#!/usr/bin/env bash
# Shared Bash helpers. Entry points set strict mode and own the temporary dir.
die() { printf '::error title=Deployment failed::%s\n' "$*" >&2; exit 1; }
required() { [[ -n ${!1:-} ]] || die "Configure $1 before deploying."; }
out() {
  [[ "$2" != *$'\n'* && "$2" != *$'\r'* ]] || die 'Invalid multiline workflow output.'
  [[ -z ${GITHUB_OUTPUT:-} ]] || printf '%s=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"
}
mask() {
  [[ ${GITHUB_ACTIONS:-} == true ]] || return 0
  local value=${1//%/%25}; value=${value//$'\r'/%0D}; value=${value//$'\n'/%0A}
  printf '::add-mask::%s\n' "$value" >&2
}
uri() { jq -nr --arg value "$1" '$value | @uri'; }
sha256() { openssl dgst -sha256 | awk '{print $NF}'; }
private_json() {
  mkdir -p "$(dirname "$1")"
  local temporary; temporary=$(mktemp "$(dirname "$1")/.rns-json.XXXXXX")
  cat > "$temporary"; chmod 600 "$temporary"; mv -f "$temporary" "$1"
}
sanitize() {
  local text=$1 secret key
  for key in VERCEL_TOKEN NEON_API_KEY GITHUB_TOKEN GH_TOKEN DATABASE_URL; do
    secret=${!key:-}; [[ -z "$secret" ]] || text=${text//"$secret"/<REDACTED>}
  done
  if [[ -f ${STATE_FILE:-/nonexistent} ]]; then
    while IFS= read -r secret; do
      [[ -z "$secret" ]] || text=${text//"$secret"/<REDACTED>}
    done < <(jq -r '.runtime // {} | .[]' "$STATE_FILE")
  fi
  printf '%s\n' "$text" | sed -E \
    -e 's@postgres(ql)?(\+[[:alnum:]_]+)?://[^[:space:]"<>]+@<REDACTED DATABASE URL>@g' \
    -e 's@(x-vercel-protection-bypass[:=])[[:space:]]*[^[:space:]]+@\1<REDACTED>@g'
}
api() {
  local provider=$1 method=$2 path=$3 data=${4:-} missing=${5:-false}
  local base token response status attempt separator='?'
  case "$provider" in
    neon) required NEON_API_KEY; base=https://console.neon.tech/api/v2; token=$NEON_API_KEY ;;
    vercel)
      required VERCEL_TOKEN; required VERCEL_ORG_ID
      base=https://api.vercel.com; token=$VERCEL_TOKEN
      [[ "$path" != *'?'* ]] || separator='&'
      path+="${separator}teamId=$(uri "$VERCEL_ORG_ID")"
      ;;
    github) required GITHUB_TOKEN; base=https://api.github.com; token=$GITHUB_TOKEN ;;
    *) die 'Unknown provider.' ;;
  esac
  [[ "$token" != *$'\n'* && "$token" != *$'\r'* ]] || die 'Invalid provider token.'
  token=${token//\\/\\\\}; token=${token//\"/\\\"}
  response=$(mktemp "$CI_TMP/api.XXXXXX")
  local args=(--disable --silent --show-error --max-time 60 --request "$method" --output "$response" --write-out '%{http_code}')
  [[ -z "$data" ]] || args+=(--data-binary "@$data")
  for attempt in 0 1 2; do
    # Authentication comes through stdin, never command arguments or saved output.
    status=$(printf 'header = "Authorization: Bearer %s"\nheader = "Content-Type: application/json"\n' "$token" |
      curl "${args[@]}" --config - "$base$path") || die 'Provider network request failed.'
    if [[ "$status" == 404 && "$missing" == true ]]; then printf 'null\n'; return; fi
    if [[ "$status" == 2?? ]]; then jq -e . "$response"; return; fi
    if [[ "$method" == GET && "$attempt" != 2 && "$status" =~ ^(423|429|502|503|504)$ ]]; then sleep "$((2 ** attempt))"; continue; fi
    local detail; detail=$(jq -r '(.message // .error.message // "") | if type == "string" then . else "" end' "$response" 2>/dev/null) || detail=''
    detail=$(sanitize "$detail" | sed -E 's@https?://[^[:space:]]+@<REDACTED URL>@g' | head -c 500)
    die "$provider $method request failed: HTTP $status. $detail"
  done
}
alias_name() {
  local project=$1 branch=$2 target=$3 digest
  if [[ "$target" == production ]]; then printf '%s.vercel.app\n' "$project"; return; fi
  digest=$(printf '%s:%s' "$project" "$branch" | sha256)
  printf '%s-preview-%s.vercel.app\n' "${project:0:42}" "${digest:0:12}"
}
vercel_deployments() {
  local project=$1 cursor='' page accumulated='[]' count path
  for ((count=0; count<10; count++)); do
    path="/v6/deployments?projectId=$(uri "$project")&state=READY&limit=100"
    [[ -z "$cursor" ]] || path+="&until=$(uri "$cursor")"
    page=$(api vercel GET "$path")
    accumulated=$(jq -cn --argjson previous "$accumulated" --argjson page "$page" '$previous + $page.deployments')
    cursor=$(jq -r '.pagination.next // empty' <<< "$page")
    if [[ -z "$cursor" ]]; then printf '%s\n' "$accumulated"; return; fi
  done
  die 'Deployment history exceeds the pagination limit.'
}
select_deployment() {
  jq -c --arg branch "$1" --arg target "$2" '
    map(select((.readyState // .state) == "READY") |
      select(if $target == "production" then .target == "production"
             else .target != "production" and .meta.githubCommitRef == $branch end))
    | max_by(.createdAt // .created // 0) // null'
}
checked_alias() {
  local result; result=$(api vercel GET "/v4/aliases/$(uri "$1")" '' true)
  jq -e --arg project "$2" '. == null or .projectId == $project' <<< "$result" >/dev/null || die 'The requested alias belongs to another project.'
  printf '%s\n' "$result"
}
assign_alias() {
  local current payload
  current=$(checked_alias "$1" "$2")
  [[ $(jq -r '.deploymentId // empty' <<< "$current") != "$3" ]] || return 0
  payload=$(mktemp "$CI_TMP/alias.XXXXXX")
  jq -n --arg alias "$1" '{alias:$alias}' > "$payload"
  api vercel POST "/v2/deployments/$(uri "$3")/aliases" "$payload" >/dev/null
}
neon_parent() {
  required NEON_PROJECT_ID
  local parent
  printf 'Production parent selector: %s\n' "${NEON_PARENT_BRANCH_ID:-project default}" >&2
  parent=$(api neon GET "/projects/$(uri "$NEON_PROJECT_ID")/branches" |
    jq -er --arg selected "${NEON_PARENT_BRANCH_ID:-}" '
      [.branches[] | select(if $selected == "" then .default else .id == $selected or .name == $selected end)]
      | if length == 1 then .[0].id else error("Ambiguous Neon parent; configure NEON_PARENT_BRANCH_ID") end') || die 'Could not resolve the production parent.'
  printf 'Selected production parent: %s\n' "$parent" >&2
  printf '%s\n' "$parent"
}
neon_branch() {
  local create=${1:-false} branches matches parent payload result branch
  if [[ ${DEPLOY_TARGET:?} == production ]]; then neon_parent; return; fi
  branches=$(api neon GET "/projects/$(uri "$NEON_PROJECT_ID")/branches")
  matches=$(jq -c --arg name "preview/${DEPLOY_BRANCH:?}" '[.branches[] | select(.name == $name)]' <<< "$branches")
  case $(jq length <<< "$matches") in
    1)
      branch=$(jq -r '.[0].id' <<< "$matches")
      printf 'Reusing existing Neon preview: preview/%s (%s). No branch created.\n' "$DEPLOY_BRANCH" "$branch" >&2
      printf '%s\n' "$branch"; return
      ;;
    0) [[ "$create" == true ]] || die 'No matching Neon preview exists. Run the database workflow first.' ;;
    *) die 'The Neon preview name is ambiguous.' ;;
  esac
  parent=$(neon_parent); payload=$(mktemp "$CI_TMP/neon.XXXXXX")
  printf 'No preview/%s branch exists. Creating it from %s.\n' "$DEPLOY_BRANCH" "$parent" >&2
  jq -n --arg name "preview/$DEPLOY_BRANCH" --arg parent "$parent" \
    '{branch:{name:$name,parent_id:$parent},endpoints:[{type:"read_write"}]}' > "$payload"
  result=$(api neon POST "/projects/$(uri "$NEON_PROJECT_ID")/branches" "$payload")
  branch=$(jq -er '.branch.id' <<< "$result") || die 'Neon did not return a created branch ID.'
  printf 'Created Neon preview: preview/%s (%s).\n' "$DEPLOY_BRANCH" "$branch" >&2
  printf '%s\n' "$branch"
}
neon_connection() {
  local result value
  printf 'Resolving private database connection for branch %s (pooled=%s).\n' "$1" "$2" >&2
  result=$(api neon GET "/projects/$(uri "$NEON_PROJECT_ID")/connection_uri?branch_id=$(uri "$1")&database_name=$(uri "${NEON_DATABASE_NAME:-neondb}")&role_name=$(uri "${NEON_ROLE_NAME:-neondb_owner}")&pooled=$2")
  value=$(jq -er '.uri' <<< "$result") || die 'Neon did not return a database connection.'
  mask "$value"
  printf '%s\n' "$value"
}
