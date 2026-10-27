#!/usr/bin/env bash
set -euo pipefail
repo=$(mktemp -d "$RUNNER_TEMP/changed-path.XXXXXX")
trap 'rm -rf "$repo"' EXIT
GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$GH_TOKEN" | base64 | tr -d '\n')"
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.extraHeader GIT_CONFIG_VALUE_0
printf '::add-mask::%s\n' "${GIT_CONFIG_VALUE_0#*basic }"
git init --bare --quiet "$repo"
git -C "$repo" fetch --quiet --depth=1 --filter=blob:none "$GITHUB_SERVER_URL/$GITHUB_REPOSITORY.git" "$BEFORE" "$AFTER"
paths=$(git -C "$repo" diff --name-only --no-renames -z "$BEFORE" "$AFTER" | jq -Rs 'split("\u0000")[:-1]')
printf 'Searched path: %s\nChanged paths:\n' "$(jq -Rn --arg path "$CHECK_PATH" '$path')"
jq -C . <<< "$paths"
jq -r --arg path "$CHECK_PATH" '"changed=\(any(.[]; contains($path)))"' <<< "$paths" | tee -a "$GITHUB_OUTPUT"
