---
name: orchestration
description: >
  How the main session delegates work: routing to builder, reviewer and chore-runner, interview then design before delegating, review rounds, readiness and owner hand-offs.
  Load it in the main session at the start of any task, before planning, editing or spawning a helper. Not for spawned subagents.
---

# Orchestration

## Routing

The main session plans, decides and talks to the owner. If the brief would be longer than the job, it does the job itself: inputs in hand, 1-3 commands, no waiting. That includes a fix of about 5 lines with no logic change (wording, a comment, a pin, one flag): edit and commit it in your own `workspace.sh` clone, no builder.

| Work                                         | Helper (model)                        |
| -------------------------------------------- | ------------------------------------- |
| Edits, commits, fix rounds, rework           | `builder` (sonnet)                    |
| Waiting or polling, noisy logs, batch sweeps | `chore-runner` (haiku), in background |
| Reviews, fix-checks, attacker-minded reviews | `reviewer` (opus)                     |
| Deep investigation                           | `general-purpose` (opus)              |
| Broad read-only search across files or repos | `Explore` (haiku)                     |

Push reviewed commits yourself from the `workspace.sh` clone that holds them, never the shared checkout, with `push-reviewed.sh <base> <sha> <branch>`, only once fresh reviews cover that exact range and the last round is READY (every full-review lens, then each fix-check; a verbatim fix you checked under step 3 counts as reviewed and READY); if it stops, tell the owner. Give the pushed sha to the CI wait, and the range it prints to any post-push validator the repo's rules name.

## Interview, then design, before delegating

New work, or a change to an approach the owner picked, starts with the `interview` skill, even when an issue already describes it: an issue records the ask, not the owner's current intent. Then show the owner a design: current setup (check existing controls first), target layout, per-repo changes, migration order, and the riskiest assumption with how a helper will prove it. Once approved, brief the helper with the design verbatim, its gate checks, and "stop and report if a gate fails; don't change the design". Never trade away a capability the owner relies on (auto-discovery, automation) without saying so in the design. Write the design of large or risky work to a file and run `spec-review` on it before showing the owner: a design flaw found in code review costs fix rounds. Fix rounds need no new interview or design. Small judgement calls inside the design are fine; anything that grows into its own feature or workstream (a new component, safety layer or review loop) is scope creep: stop and ask the owner first (an unapproved add-on once became a whole workstream).

## Running helpers

- Each helper works in its own clone from `workspace.sh <owner/repo> <task-name>`, the one way for every repo (no worktrees or hand-made clones); it stages only its own files, and waits for other helpers on the same repo
- Steer a running helper with `SendMessage`, never duplicate it; use a new helper per fix round you delegate
- A brief for a builder that follows a BLOCKED one names that builder's kept notes path
- A pre-existing CI failure a helper flags: tell the owner and start a separate fix round at once
- Never wait for Renovate's bump PR: tick the update's box in the repo's `Renovate Dashboard` issue (else `manual job`), then have a `chore-runner` poll for it (edit the line from `- [ ]` to `- [x]` and pipe the body to `gh issue edit <n> --body-file -`; no Write tool)
- Every brief has the goal and evidence (`file:line`), constraints and merge rules, what not to touch, when to stop, a report cap, and the Definition of Ready
- A CI-wait brief gives `--repo <owner/repo>`, the PR or sha, and any `--no-sonar`/`--no-codeql`; never a command such as `gh pr checks` or `gh run watch`: `chore-runner` has its own wait command
- A PR's work goes in one push: each push re-runs approval-gated jobs and emails the owner per job; fix commit wording at squash-merge time, not with follow-up commits
- Spot-check key helper claims (PR state, run status) when cheap

## Review and readiness

Every PR and fix round gets a fresh reviewer, never the author (bot PRs below and verbatim fixes in step 3 excepted). Security-sensitive changes get an attacker-minded brief. Threats: fork and outsider PRs, prompt-injected or compromised AI agents and bots. Trusted: the owner and deterministic apps (Renovate, release bot, Mergify, GitHub Actions). Grade a security finding by its real impact: what an attacker gains that existing controls don't already stop. Drop it if that's nothing.

Review wide once, then check only the fixes (fresh reviewers each re-reviewing everything find new nits forever):

1. **Full review** - Run reviewers in parallel, one per lens: correctness, rules, and security when it applies. A diff under about 50 lines gets one reviewer with no lens. Merge their findings into one deduplicated list, then re-grade it yourself: a MINOR that causes wrong behaviour (a bug, wrong output, lost data) is a MAJOR.
2. **Fix round** - One commit fixes every BLOCKER and MAJOR, plus each MINOR worth fixing: a reader or user would trip on it, or it breaks a repo convention. Drop taste-only MINORs; one worth fixing can start a round alone.
3. **Fix-check** - A fresh reviewer in fix-check mode gets the list and the fix range, and looks only there; a BLOCKER it happens to see outside that range is still reported, without hunting for more. Skip it when the fix only pastes in the reviewers' exact suggested text: check that with `git diff` yourself.
4. **Cap** - If BLOCKER or MAJOR findings remain after two fix rounds, stop and take the list to the owner: repeat blockers usually mean the design is wrong.

Never open follow-up issues for review findings unless the owner asks; unfixed MINORs are dropped.

Definition of Ready, before approving, asking the owner to approve, or merging: READY from every full-review lens or, after a fix round, from the latest fix-check or your step 3 `git diff` check, owner comments and threads checked, CI green, every gate the repo has.

## Owner

- Stay quiet while helpers run unless a decision or owner-only step (UI, secrets, PR approvals) needs them: 2 options max, with a recommendation
- Put the question first with the full context to answer it there, plus clickable links; the owner is often on a phone
- Re-check live state before listing an owner step, and check that review requests reached the owner
- Approve a PR yourself only when `gh pr view <n> --json author` shows one of these logins; all others, and PRs you or your helpers opened, go to the owner. These pass on:
  - `app/renovate`: CI green and the repo's Renovate triage skill, if it has one, returns SAFE; else ask the owner
  - `app/repo-operator-release-bot`: CI green and the diff touches only `.release-please-manifest.json`, `CHANGELOG.md`, the project's own `version` in `package.json`/`package-lock.json`/`pyproject.toml`/`uv.lock` (no dependency entries), and the one-line stamp in `megalinter-*/.rebuild-stamp` files
- Once you approve one of these PRs, merge it with `gh pr merge <n> --squash --repo <owner/repo>`. If branch rules block that, read its `Mergify Merge Protections` check and labels at once: when every protection passes and it has no `blocked` or `agent/needs-human-review` label, Mergify's queue merges it within minutes, so let it; otherwise report what blocks it.

## Improving this file

Triage helper feedback before showing any: recast `[definition]`/`[rules]` items your brief caused as `[brief]` and fix your next briefs; drop intended behaviour and fixes already pending. Show the owner only items that cost something this session (a wrong result, an extra fix round, or a blocked helper) and that a change would stop recurring; drop wishes and complaints. When the owner corrects how you orchestrate, a helper round fails because a brief missed something, or the same `[brief]` gap shows up twice, suggest a one-line change to this file. Edit agent files, rules, `CLAUDE.md` or hooks only once the owner approves. The synced orchestration skill, rules, agents and skills change in repo-operator `src/templates/.claude/...`, not in the repo's copy. Run `orchestration-retro` monthly or when asked.

## Session moves

Switching the Happy session between phone and workspace, or pressing stop, kills running subagents (anthony-spruyt/spruyt-labs#3370). On "wind down", start no new helpers until the owner says go.
