#!/usr/bin/env bash
set -euo pipefail

before=$(jq -er '.before' "$GITHUB_EVENT_PATH")
after=$(jq -er '.after' "$GITHUB_EVENT_PATH")
files=$(
  git diff --name-only --no-renames -z "$before" "$after" -- |
    jq -Rs 'split("\u0000")[:-1]'
)
printf 'Searched path: %q\n' "${1:?}"
printf 'Changed paths:\n%s\n' "$files"
changed=$(jq --arg path "$1" 'any(.[]; contains($path))' <<< "$files")
printf 'Match: %s\n' "$changed"
printf 'changed=%s\n' "$changed" >> "$GITHUB_OUTPUT"
