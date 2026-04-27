#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_BRANCH="${FRONTEND_DEPLOY_BRANCH:-build}"
DEPLOY_REMOTE_URL="${FRONTEND_DEPLOY_REMOTE_URL:-}"

for arg in "$@"; do
  case "$arg" in
    --help|-h)
      cat <<'USAGE'
Usage:
  ./scripts/deploy-frontend.sh

Environment:
  FRONTEND_DEPLOY_BRANCH       Branch to publish dist to (default: build)
  FRONTEND_DEPLOY_REMOTE_URL   Override the git remote URL used for push
  GITHUB_TOKEN                 Used in GitHub Actions to authenticate the push
USAGE
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but not installed." >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "git is required but not installed." >&2
  exit 1
fi

pushd "$ROOT_DIR" >/dev/null

echo "Building frontend bundle..."
npm run build

if [[ ! -d dist ]]; then
  echo "Build output dist/ was not created." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

rsync -a --delete --exclude '.git' dist/ "$TMP_DIR/"

SOURCE_SHA="$(git rev-parse --short HEAD)"
COMMIT_MESSAGE="Deploy frontend: ${SOURCE_SHA}"

git init -q "$TMP_DIR"
git -C "$TMP_DIR" config user.name "github-actions[bot]"
git -C "$TMP_DIR" config user.email "github-actions[bot]@users.noreply.github.com"
git -C "$TMP_DIR" add -A
git -C "$TMP_DIR" commit -q -m "$COMMIT_MESSAGE"
git -C "$TMP_DIR" branch -M "$DEPLOY_BRANCH"

if [[ -z "$DEPLOY_REMOTE_URL" ]]; then
  DEPLOY_REMOTE_URL="$(git remote get-url origin)"
fi

if [[ -n "${GITHUB_TOKEN:-}" && -n "${GITHUB_REPOSITORY:-}" ]]; then
  DEPLOY_REMOTE_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
fi

git -C "$TMP_DIR" remote add origin "$DEPLOY_REMOTE_URL"
git -C "$TMP_DIR" push -f origin "$DEPLOY_BRANCH"

echo "Frontend published to branch: $DEPLOY_BRANCH"
popd >/dev/null
