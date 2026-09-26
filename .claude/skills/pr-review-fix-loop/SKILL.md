---
name: pr-review-fix-loop
description: Use when a PR or branch needs automated review and fixing, when the user says "review and fix", "clean up this PR", "fix PR issues", or wants to iterate a PR to passing state
---

# PR Review-Fix Loop

Orchestrate an automated review-fix loop for a PR using subagents. You are the **controller only** - you dispatch subagents and manage the loop. You NEVER read code, edit files, run tests, or fix issues yourself.

**Core principle:** Controller dispatches, subagents work. Fresh context per review. Loop until clean or max iterations.

## Input Resolution

```dot
digraph input {
    "Argument provided?" [shape=diamond];
    "Use provided PR/branch" [shape=box];
    "On a branch (not main)?" [shape=diamond];
    "gh pr list --head <branch>" [shape=plaintext];
    "PR found?" [shape=diamond];
    "Use found PR" [shape=box];
    "Ask user for PR number or branch" [shape=box];
    "Ready" [shape=doublecircle];

    "Argument provided?" -> "Use provided PR/branch" [label="yes"];
    "Argument provided?" -> "On a branch (not main)?" [label="no"];
    "On a branch (not main)?" -> "gh pr list --head <branch>" [label="yes"];
    "On a branch (not main)?" -> "Ask user for PR number or branch" [label="no"];
    "gh pr list --head <branch>" -> "PR found?";
    "PR found?" -> "Use found PR" [label="yes"];
    "PR found?" -> "Ask user for PR number or branch" [label="no"];
    "Use provided PR/branch" -> "Ready";
    "Use found PR" -> "Ready";
    "Ask user for PR number or branch" -> "Ready";
}
```

## The Loop

```dot
digraph loop {
    rankdir=TB;

    "Start: Have PR number" [shape=doublecircle];
    "iteration < max (default 10)?" [shape=diamond];
    "Dispatch 3 review subagents IN PARALLEL" [shape=box];
    "Collect all issues from all 3" [shape=box];
    "Any issues found?" [shape=diamond];
    "Dispatch fixer subagent with ALL issues" [shape=box];
    "Fixer commits and pushes" [shape=box];
    "Wait for CI to start" [shape=box];
    "Increment iteration" [shape=box];
    "STOP: Report remaining issues to user" [shape=octagon, style=filled, fillcolor=red, fontcolor=white];
    "Done: PR is clean" [shape=doublecircle];

    "Start: Have PR number" -> "iteration < max (default 10)?";
    "iteration < max (default 10)?" -> "Dispatch 3 review subagents IN PARALLEL" [label="yes"];
    "iteration < max (default 10)?" -> "STOP: Report remaining issues to user" [label="no"];
    "Dispatch 3 review subagents IN PARALLEL" -> "Collect all issues from all 3";
    "Collect all issues from all 3" -> "Any issues found?";
    "Any issues found?" -> "Done: PR is clean" [label="no"];
    "Any issues found?" -> "Dispatch fixer subagent with ALL issues" [label="yes"];
    "Dispatch fixer subagent with ALL issues" -> "Fixer commits and pushes";
    "Fixer commits and pushes" -> "Wait for CI to start";
    "Wait for CI to start" -> "Increment iteration";
    "Increment iteration" -> "iteration < max (default 10)?";
}
```

## Subagent Dispatch

### Review Phase (3 subagents in parallel via a single message with 3 Agent tool calls)

| #   | Subagent Type               | Model   | Prompt essence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | --------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `superpowers:code-reviewer` | default | Review PR #{number} diff (base..HEAD). Return `[CRITICAL/IMPORTANT/MINOR] file:line - description` or `NO ISSUES`.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2   | `general-purpose`           | haiku   | Check CI status (`gh pr checks`), CodeQL alerts (`gh api code-scanning/alerts`), lint results for PR #{number}. Return `[CI_FAIL/CODEQL/LINT] check - description` or `NO ISSUES`.                                                                                                                                                                                                                                                                                                                                                    |
| 3   | `general-purpose`           | haiku   | Check ALL comments on PR #{number} from ALL sources and ALL authors (human and bot alike). Query all three endpoints: (1) `gh api repos/{owner}/{repo}/pulls/{number}/comments` — inline review comments, (2) `gh api repos/{owner}/{repo}/pulls/{number}/reviews` — review submissions, (3) `gh api repos/{owner}/{repo}/issues/{number}/comments` — general comments. Every comment is potentially actionable. Report each as `[COMMENT] author: summary (source)` or `NO ISSUES` if all three endpoints return nothing actionable. |

### Fix Phase (1 subagent, sequential after all reviews complete)

| Subagent Type     | Model   | Prompt essence                                                                                                                                                                                                                                                                        |
| ----------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `general-purpose` | default | Fix ALL issues below on branch {branch}. Prioritize CRITICAL > IMPORTANT > MINOR. After fixing, verify with `npm test`, `npx tsc --noEmit`, `npm run test:typecheck`, and `npm run docs:check` (run from `packages/xfg/`), and `./lint.sh` (run from the repo root). All five must pass before committing. Commit and **push**. Report what was fixed and what remains. `{combined_issues}` |

## Controller Rules

You are the controller: you dispatch subagents and track the loop, and you don't read code, edit files, run tests/lint/build, commit, or fix anything yourself - not even one small thing. Keeping the controller out of the code keeps each reviewer's context fresh and independent.

- Dispatch all 3 review subagents in parallel (single message, 3 Agent calls), every iteration - comments and CI results can appear mid-loop.
- Dispatch the fixer only after collecting ALL review results, then loop back to a fresh review even if the fixer reports done.
- Treat every comment as actionable, including bot comments (coverage, lint, security).
- If a reviewer returns unusable output, dispatch it again rather than interpreting it.
- Track the iteration count and report progress between iterations.
- Stop at max iterations (default 10, change only with user consent) and report remaining issues.

**Between iterations, report:**

```
Iteration {n}/{max}: {summary}
- Code review: {n} issues
- CI/CodeQL: {n} issues
- Comments: {n} items
```
