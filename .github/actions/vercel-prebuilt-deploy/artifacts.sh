#!/usr/bin/env bash
# Public Build Output v3, portable artifact protocol v2. No runtime credentials.
ARTIFACT_VERSION=2
canonical() {
  if command -v grealpath >/dev/null; then grealpath -m -- "$1"; else realpath -m -- "$1"; fi
}
inside() { [[ "$1" == "$2" || "$1" == "$2/"* ]]; }
portable_copy() {
  local source=$1 destination=$2 allowed=$3 resolved ancestor child
  shift 3
  resolved=$(canonical "$source")
  inside "$resolved" "$allowed" || die 'Build output contains an external symlink.'
  for ancestor in "$@"; do [[ "$resolved" != "$ancestor" ]] || die 'Build output contains a symlink cycle.'; done
  [[ ${source##*/} != .env* ]] || return 0
  if [[ -d "$source" ]]; then
    mkdir -p "$destination"
    for child in "$source"/* "$source"/.[!.]* "$source"/..?*; do
      [[ -e "$child" || -L "$child" ]] || continue
      portable_copy "$child" "$destination/${child##*/}" "$allowed" "$@" "$resolved"
    done
  else
    [[ -f "$source" ]] || die 'Missing or unsupported build output file.'
    mkdir -p "$(dirname "$destination")"; cp -pL "$source" "$destination"
  fi
}
materialize_file_maps() {
  local output=$1 workspace=$2 config root relative source destination temporary
  [[ -d "$output/functions" ]] || return 0
  while IFS= read -r -d '' config; do
    root=$(canonical "$(dirname "$config")")
    if ! inside "$root" "$workspace" || ! inside "$(canonical "$config")" "$root"; then die 'Function metadata escapes the checkout.'; fi
    while IFS= read -r -d '' relative && IFS= read -r -d '' source; do
      case "/$relative/" in *'/../'*|*'/./'*|//*) die 'Unsafe mapped function destination.' ;; esac
      case "/$relative/" in */.env*|*/__pycache__/*|*/.pytest_cache/*|*/.ruff_cache/*) continue ;; esac
      destination=$(canonical "$root/$relative"); source=$(canonical "$workspace/$source")
      inside "$destination" "$root" && inside "$source" "$workspace" && [[ -f "$source" ]] || die 'Function mappings must be checkout-local files.'
      [[ "$destination" == "$source" ]] || portable_copy "$source" "$destination" "$workspace"
    done < <(jq -j '.filePathMap // {} | to_entries[] | .key,"\u0000",.value,"\u0000"' "$config")
    temporary=$(mktemp "$CI_TMP/config.XXXXXX")
    jq 'del(.filePathMap)' "$config" > "$temporary"; cp "$temporary" "$config"
  done < <(find -L "$output/functions" -name .vc-config.json -print0)
}
pack_output() {
  local source=$1 archive=$2 component=$3 workspace stage name config temporary secret key
  jq -e '.version == 3 and (.services | not) and (.daemons | not)' "$source/config.json" >/dev/null || die 'Unsupported portable Build Output configuration.'
  workspace=$(canonical "${GITHUB_WORKSPACE:-$source}")
  inside "$(canonical "$source")" "$workspace" || workspace=$(canonical "$source")
  materialize_file_maps "$source" "$workspace"
  stage=$(mktemp -d "$CI_TMP/pack.XXXXXX"); mkdir "$stage/output"
  for name in config.json functions static; do
    [[ ! -e "$source/$name" ]] || portable_copy "$source/$name" "$stage/output/$name" "$workspace"
  done
  while IFS= read -r -d '' config; do
    temporary=$(mktemp "$CI_TMP/config.XXXXXX")
    jq '.environment = ((.environment // {}) | with_entries(select(.key | IN("PYTHONPATH","PYTHONHOME","PYTHONUNBUFFERED","NODE_ENV","TZ","LANG","LC_ALL"))))' "$config" > "$temporary"
    cp "$temporary" "$config"
  done < <(find "$stage/output" -name .vc-config.json -print0)
  for key in VERCEL_TOKEN NEON_API_KEY GITHUB_TOKEN DATABASE_URL; do
    secret=${!key:-}; [[ -n "$secret" ]] || continue
    if printf '%s\n' "$secret" | grep -rFq -f - "$stage/output"; then die 'Credential found in build output; refusing upload.'; fi
  done
  jq -n --arg component "$component" --argjson version "$ARTIFACT_VERSION" '{version:$version,component:$component}' > "$stage/manifest.json"
  mkdir -p "$(dirname "$archive")"
  tar -czf "$archive" -C "$stage" output manifest.json
}
restore_output() {
  local archive=$1 destination=$2 component=$3 name listing stage size_column=3
  listing=$(mktemp "$CI_TMP/members.XXXXXX")
  tar -tzf "$archive" > "$listing" || die 'Invalid build output archive.'
  while IFS= read -r name; do
    case "$name" in output|output/|output/*|manifest.json) ;; *) die 'Unsafe archive member.' ;; esac
    case "/$name/" in *'/../'*|*'/./'*|*\\*) die 'Archive traversal or escaped filenames are not allowed.' ;; esac
  done < "$listing"
  if tar --version | grep -q bsdtar; then size_column=5; fi
  tar -tvzf "$archive" > "$listing"
  awk -v size_column="$size_column" '
    substr($1,1,1) != "-" && substr($1,1,1) != "d" {bad=1}
    {size += $size_column}
    END {exit (bad || size > 2147483648)}' "$listing" || die 'Archive contains links/special files or exceeds the size limit.'
  stage=$(mktemp -d "$CI_TMP/restore.XXXXXX")
  tar -xzf "$archive" -C "$stage" --no-same-owner --no-same-permissions
  jq -e --arg component "$component" --argjson version "$ARTIFACT_VERSION" \
    '. == {version:$version,component:$component}' "$stage/manifest.json" >/dev/null || die 'Incompatible build output artifact.'
  # Only this generated output directory is replaced; never the checkout itself.
  [[ -n "$destination" && "$destination" != / && "$destination" != . ]] || die 'Unsafe output destination.'
  [[ ! -e "$destination" ]] || rm -rf -- "$destination"
  mkdir -p "$(dirname "$destination")"; cp -R "$stage/output" "$destination"
}
inject_runtime() {
  local output=$1 runtime=$2 config temporary count=0
  while IFS= read -r -d '' config; do
    temporary=$(mktemp "$CI_TMP/config.XXXXXX")
    jq --slurpfile runtime "$runtime" '.environment = ((.environment // {}) + $runtime[0])' "$config" > "$temporary"
    cp "$temporary" "$config"; count=$((count + 1))
  done < <(find "$output/functions" -name .vc-config.json -print0)
  [[ "$count" -gt 0 ]] || die 'No runtime function configuration was found.'
}
