#!/usr/bin/env bash
set -euo pipefail

if ! command -v supabase >/dev/null 2>&1; then
  echo "Supabase CLI is required for drift checks."
  exit 1
fi

echo "Running migration drift check against linked project..."
supabase db push --dry-run --include-all
