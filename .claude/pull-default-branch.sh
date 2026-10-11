#!/bin/bash
# No ${...} here - xfg would substitute it on sync.
# Never prints and always exits 0: it must not block a prompt or a helper.
exec >/dev/null 2>&1
set -u

input=$(cat || true)
project=$(printenv CLAUDE_PROJECT_DIR || true)
cwd=$(jq -r '.cwd // empty' <<<"$input" || true)
start=$project
[[ -n "$start" ]] || start=$cwd
[[ -n "$start" ]] || start=$PWD

command -v timeout >/dev/null || exit 0
# The first entry of the list is the main worktree, also from a linked one
main=$(git -C "$start" worktree list --porcelain | sed -n '1s/^worktree //p') || exit 0
[[ -n "$main" ]] || exit 0

ref=$(git -C "$main" symbolic-ref -q refs/remotes/origin/HEAD) || exit 0
# shellcheck disable=SC2001
branch=$(sed 's|^refs/remotes/origin/||' <<<"$ref")
[[ -n "$branch" && "$branch" != "$ref" ]] || exit 0
# --branch expands forms like @{-1}, so the printed name must equal the input
[[ "$(git -C "$main" check-ref-format --branch "$branch")" == "$branch" ]] || exit 0

[[ "$(git -C "$main" symbolic-ref -q HEAD)" == "refs/heads/$branch" ]] || exit 0

gitdir=$(git -C "$main" rev-parse --absolute-git-dir) || exit 0
for state in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_LOG; do
  [[ ! -e "$gitdir/$state" ]] || exit 0
done

GIT_TERMINAL_PROMPT=0 timeout 5 git -c core.hooksPath=/dev/null -C "$main" fetch --quiet origin "refs/heads/$branch:refs/remotes/origin/$branch" || true
# ff-only refuses rather than touch local changes that upstream also changes
git -c core.hooksPath=/dev/null -C "$main" merge --ff-only --quiet "refs/remotes/origin/$branch" || true
exit 0
