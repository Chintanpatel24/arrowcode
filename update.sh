#!/usr/bin/env bash
set -euo pipefail

# ArrowCode local updater script
# Updates the ArrowCode repository to the latest code on the current branch while preserving local changes

RED=$'\033[0;31m'
GRN=$'\033[0;32m'
CYN=$'\033[0;36m'
RST=$'\033[0m'

log()  { printf '%s==>%s %s\n' "$CYN" "$RST" "$*"; }
ok()   { printf '%s[ok]%s %s\n' "$GRN" "$RST" "$*"; }
err()  { printf '%s[err]%s %s\n' "$RED" "$RST" "$*" >&2; }

# Find ArrowCode base directory
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

log "Updating ArrowCode at $DIR..."

# Keep local changes with git stash if there are any
HAS_CHANGES=0
if ! git diff --quiet || ! git diff --cached --quiet; then
  HAS_CHANGES=1
  log "Saving local changes with git stash..."
  git stash -u
fi

# Fetch and rebase / merge latest from branch
BRANCH=$(git rev-parse --abbrev-ref HEAD)
log "Fetching latest commits from remote on branch: $BRANCH"
git fetch origin "$BRANCH"

log "Pulling latest changes..."
git pull --rebase origin "$BRANCH"

# Restore local changes if stashed
if [ "$HAS_CHANGES" -eq 1 ]; then
  log "Restoring local changes..."
  git stash pop
fi

# Re-install dependencies with bun
log "Running bun install to ensure package sync..."
bun install

ok "ArrowCode successfully updated!"
