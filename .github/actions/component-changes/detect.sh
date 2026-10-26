#!/usr/bin/env bash
set -euo pipefail

before=$(jq -er '.before' "$GITHUB_EVENT_PATH")
after=$(jq -er '.after' "$GITHUB_EVENT_PATH")
files=$(
  gh api "repos/$GITHUB_REPOSITORY/compare/$before...$after" |
    jq -c '
      if .status != "ahead" and .status != "identical" then error("Expected a forward commit comparison")
      else .files end'
)
paths=$(jq -c '[.[] | .filename, (.previous_filename // empty)] | unique' <<< "$files")
printf 'Searched path: %q\n' "${1:?}"
printf 'Changed paths:\n'
jq -C . <<< "$paths"
if [[ $(jq length <<< "$files") -ge 300 ]]; then
  printf 'GitHub comparison reached the 300-file cap; assuming the searched path changed.\n'
  changed=true
else
  changed=$(jq --arg path "$1" 'any(.[]; contains($path))' <<< "$paths")
fi
printf 'Match: %s\n' "$changed"
printf 'changed=%s\n' "$changed" >> "$GITHUB_OUTPUT"
