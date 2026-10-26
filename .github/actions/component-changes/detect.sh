#!/usr/bin/env bash
set -euo pipefail

before=$(jq -er '.before' "$GITHUB_EVENT_PATH")
after=$(jq -er '.after' "$GITHUB_EVENT_PATH")
files=$(
  gh api "repos/$GITHUB_REPOSITORY/compare/$before...$after" |
    jq -c '
      if .status != "ahead" and .status != "identical" then error("Expected a forward commit comparison")
      elif (.files | length) >= 300 then error("GitHub comparison file limit reached; refusing partial path detection")
      else [.files[] | .filename, (.previous_filename // empty)] | unique end'
)
printf 'Searched path: %q\n' "${1:?}"
printf 'Changed paths:\n'
jq -C . <<< "$files"
changed=$(jq --arg path "$1" 'any(.[]; contains($path))' <<< "$files")
printf 'Match: %s\n' "$changed"
printf 'changed=%s\n' "$changed" >> "$GITHUB_OUTPUT"
