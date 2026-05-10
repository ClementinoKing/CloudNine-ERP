#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_REF_FILE="$ROOT_DIR/supabase/.temp/project-ref"
DEFAULT_ENV_FILE="$ROOT_DIR/.env"
SECRETS_SCRIPT="$ROOT_DIR/scripts/sync-supabase-function-secrets.sh"

PROJECT_REF="${SUPABASE_PROJECT_REF:-}"
SECRETS_ENV_FILE="${SUPABASE_SECRETS_ENV_FILE:-$DEFAULT_ENV_FILE}"
SKIP_SECRETS=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-secrets)
      SKIP_SECRETS=1
      shift
      ;;
    --env-file)
      [[ $# -ge 2 ]] || { echo "Missing value for --env-file" >&2; exit 1; }
      SECRETS_ENV_FILE="$2"
      shift 2
      ;;
    --help|-h)
      cat <<'USAGE'
Usage:
  ./scripts/deploy-admin-invite.sh [--skip-secrets] [--env-file PATH]

Options:
  --skip-secrets   Skip syncing secrets before deploy
  --env-file PATH  Source env file for function secrets. Defaults to ./.env
USAGE
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if ! command -v supabase >/dev/null 2>&1; then
  echo "Supabase CLI is required but not installed." >&2
  exit 1
fi

if [[ -z "$PROJECT_REF" && -f "$PROJECT_REF_FILE" ]]; then
  PROJECT_REF="$(<"$PROJECT_REF_FILE")"
fi

if [[ -z "$PROJECT_REF" ]]; then
  echo "Missing project ref. Set SUPABASE_PROJECT_REF or create supabase/.temp/project-ref." >&2
  exit 1
fi

echo "Using Supabase project ref: $PROJECT_REF"

if [[ "$SKIP_SECRETS" -eq 0 ]]; then
  "$SECRETS_SCRIPT" --project-ref "$PROJECT_REF" --env-file "$SECRETS_ENV_FILE"
else
  echo "Skipping secret sync (--skip-secrets)."
fi

echo "Deploying function: admin-invite"
supabase functions deploy admin-invite --project-ref "$PROJECT_REF" --no-verify-jwt
echo "Deploy complete."
