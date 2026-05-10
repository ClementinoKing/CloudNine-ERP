#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_REF_FILE="$ROOT_DIR/supabase/.temp/project-ref"
DEFAULT_ENV_FILE="$ROOT_DIR/.env"
TMP_ENV_FILE=""

PROJECT_REF="${SUPABASE_PROJECT_REF:-}"
ENV_FILE="${SUPABASE_SECRETS_ENV_FILE:-$DEFAULT_ENV_FILE}"

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/sync-supabase-function-secrets.sh [--env-file PATH] [--project-ref REF]

Options:
  --env-file PATH     Source env file. Defaults to ./.env
  --project-ref REF   Supabase project ref. Defaults to SUPABASE_PROJECT_REF or supabase/.temp/project-ref
USAGE
}

cleanup() {
  if [[ -n "$TMP_ENV_FILE" && -f "$TMP_ENV_FILE" ]]; then
    rm -f "$TMP_ENV_FILE"
  fi
}

trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      [[ $# -ge 2 ]] || { echo "Missing value for --env-file" >&2; exit 1; }
      ENV_FILE="$2"
      shift 2
      ;;
    --project-ref)
      [[ $# -ge 2 ]] || { echo "Missing value for --project-ref" >&2; exit 1; }
      PROJECT_REF="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
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
  echo "Missing project ref. Set SUPABASE_PROJECT_REF, pass --project-ref, or create supabase/.temp/project-ref." >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Env file not found: $ENV_FILE" >&2
  exit 1
fi

TMP_ENV_FILE="$(mktemp)"

python3 - "$ENV_FILE" "$TMP_ENV_FILE" <<'PY'
from pathlib import Path
import sys

source = Path(sys.argv[1])
target = Path(sys.argv[2])
allowed = {
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "RESEND_API_KEY",
    "RESEND_FROM_EMAIL",
    "APP_BASE_URL",
    "TASK_REMINDER_DISPATCH_TOKEN",
    "NOTIFICATION_EMAIL_DISPATCH_TOKEN",
}

lines = []
for raw in source.read_text().splitlines():
    line = raw.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    key = key.strip()
    if key in allowed:
        lines.append(f"{key}={value}")

if not lines:
    raise SystemExit("No supported function secrets found in env file.")

target.write_text("\n".join(lines) + "\n")
PY

echo "Syncing Supabase function secrets from $ENV_FILE to $PROJECT_REF"
supabase secrets set --project-ref "$PROJECT_REF" --env-file "$TMP_ENV_FILE"
echo "Secrets synced."
