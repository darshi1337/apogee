#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 4 ]]; then
  echo "usage: $0 <branch> <title> <commit-message> <path>..." >&2
  exit 2
fi

branch=$1
title=$2
commit_message=$3
shift 3
paths=("$@")

: "${GH_TOKEN:?GH_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
export GH_REPO="${GH_REPO:-$GITHUB_REPOSITORY}"

body_args=()
if [[ -n "${PR_BODY_FILE:-}" ]]; then
  body_args=(--body-file "$PR_BODY_FILE")
elif [[ -n "${PR_BODY:-}" ]]; then
  body_args=(--body "$PR_BODY")
else
  echo "PR_BODY or PR_BODY_FILE is required" >&2
  exit 2
fi

find_pr() {
  gh pr list --head "$branch" --base main --state open --json number -q '.[0].number'
}

pr=$(find_pr)

if git diff --quiet -- "${paths[@]}"; then
  echo "No changes to sync."
  if [[ -n "$pr" ]]; then
    echo "Closing stale automation PR #$pr."
    gh pr close "$pr"
  fi
  exit 0
fi

git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git switch -C "$branch"
git add -- "${paths[@]}"
git commit -m "$commit_message"

gh auth setup-git
git push --force origin "$branch"

pr=$(find_pr)
if [[ -z "$pr" ]]; then
  gh pr create \
    --base main \
    --head "$branch" \
    --title "$title" \
    "${body_args[@]}"
  pr=$(find_pr)
else
  gh pr edit "$pr" --title "$title" "${body_args[@]}"
fi

if [[ -z "$(gh pr view "$pr" --json autoMergeRequest -q '.autoMergeRequest // empty')" ]]; then
  gh pr merge "$pr" --auto --squash
fi
