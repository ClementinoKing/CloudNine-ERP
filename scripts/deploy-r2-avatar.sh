#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_REF_FILE="$ROOT_DIR/supabase/.temp/project-ref"
SECRETS_ENV_FILE="$ROOT_DIR/supabase/.env.local"

PROJECT_REF="${SUPABASE_PROJECT_REF:-}"
SKIP_SECRETS=0

for arg in "$@"; do
  case "$arg" in
    --skip-secrets)
      SKIP_SECRETS=1
      ;;
    --help|-h)
      cat <<'USAGE'
Usage:
  ./scripts/deploy-r2-avatar.sh [--skip-secrets]

Options:
  --skip-secrets   Skip syncing secrets from supabase/.env.local
USAGE
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
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
  if [[ -f "$SECRETS_ENV_FILE" ]]; then
    echo "Syncing function secrets from supabase/.env.local..."
    supabase secrets set --project-ref "$PROJECT_REF" --env-file "$SECRETS_ENV_FILE"
  else
    echo "No supabase/.env.local found, skipping secret sync."
  fi
else
  echo "Skipping secret sync (--skip-secrets)."
fi

echo "Deploying function: r2-avatar"
supabase functions deploy r2-avatar --project-ref "$PROJECT_REF" --no-verify-jwt
echo "Deploy complete."
