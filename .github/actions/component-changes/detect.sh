#!/usr/bin/env bash
set -euo pipefail

before=$(jq -er '.before' "$GITHUB_EVENT_PATH")
after=$(jq -er '.after' "$GITHUB_EVENT_PATH")
changed=$(
  git diff --name-only --no-renames -z "$before" "$after" -- |
    jq -Rs --arg path "${1:?}" 'split("\u0000") | any(.[]; contains($path))'
)
printf 'changed=%s\n' "$changed" >> "$GITHUB_OUTPUT"
