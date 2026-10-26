#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=.github/actions/_shared/providers.sh
source "$SCRIPT_DIR/../_shared/providers.sh"
CI_TMP=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/rns-neon.XXXXXX")
trap 'rm -rf -- "$CI_TMP"' EXIT
trap 'printf "::error title=Neon operation failed::Bash operation failed at line %s.\n" "$LINENO" >&2' ERR

case ${1:-} in
  database-plan)
    parent=$(neon_parent) || die 'Production-parent resolution failed.'
    out parent_branch_id "$parent"
    ;;
  database-branch)
    branch=$(neon_branch true) || die 'Preview-branch preparation failed.'
    out branch_id "$branch"
    ;;
  database-env)
    connection=$(neon_connection "${NEON_BRANCH_ID:?}" false)
    printf 'DATABASE_URL=%s\n' "$connection" >> "${GITHUB_ENV:?}"
    ;;
  *) die 'Unknown Neon operation.' ;;
esac
