---
name: orchestration
description: >
  How the main session delegates work: routing to builder, reviewer and chore-runner, interview then design before delegating, review rounds, readiness and owner hand-offs.
  Load it in the main session at the start of any task, before planning, editing or spawning a helper. Not for spawned subagents.
---

# Orchestration

## Routing

You plan, decide and talk to the owner. Do a job yourself when briefing it would take longer than doing it: inputs in hand, 1-3 commands, no waiting. That covers small changes with no logic in them (wording, a comment, a pin, one flag; about 5 lines): make and commit them in your own `workspace.sh` clone (on PATH, as are `ci-status.sh` and `push-reviewed.sh`), with no builder.

| Work                                                   | Helper (model)                        |
| ------------------------------------------------------ | ------------------------------------- |
| Edits, commits, fix rounds, rework                     | `builder` (sonnet)                    |
| Waiting or polling, noisy logs, batch sweeps           | `chore-runner` (haiku), in background |
| Reviews, fix-checks, attacker-minded reviews           | `reviewer` (opus)                     |
| Root-causing and other deep investigation              | `general-purpose` (opus)              |
| Finding, listing or gathering facts, even across repos | `Explore` (haiku)                     |

## Interview, then design

New work, or a change to an approach the owner picked, starts with the `interview` skill, even when an issue describes it: the issue records the ask, not the owner's current intent. Then show the owner a design: the current setup (check existing controls first), target layout, per-repo changes, migration order, and the riskiest assumption with how a helper will prove it. If the design gives up a capability the owner relies on, such as auto-discovery or automation, say so. For large or risky work, write the design to a file and run `spec-review` on it before showing the owner: a design flaw found in code review costs fix rounds.

Once the owner approves, brief the helper with the design verbatim, its gate checks, and "stop and report if a gate fails; don't change the design". Small judgement calls inside the design are fine. Anything that grows into its own feature or workstream (a new component, safety layer or review loop) is scope creep: stop and ask the owner first. Fix rounds need no new interview or design.

## Running helpers

- Each helper works in its own clone from `workspace.sh <owner/repo> <task-name>` (no worktrees or hand-made clones), stages only its own files, and waits for other helpers on the same repo.
- Steer a running helper with `SendMessage`; never start a duplicate. Each fix round you delegate gets a new helper, and a builder that follows a BLOCKED one gets that builder's notes path.
- Every brief gives the goal and evidence (`file:line`), constraints and merge rules, whether to push or (review-first) commit and stop, what not to touch, when to stop, a report cap, and the Definition of Ready. A review brief also says whether the target is pushed (give the CI-green PR head sha) or local.
- A CI wait runs `ci-status.sh --wait --repo <owner/repo>` with the PR or sha and any `--no-sonar`/`--no-codeql`, never `gh pr checks` or `gh run watch`.
- PRs squash-merge, so extra pushes are fine; fix commit wording at squash-merge time, not with follow-up commits.
- Act on a helper's result only once it has finished (`ListAgents` doesn't show it running), and check its key claims first: the sha exists, the PR and run state.
- When a helper flags a pre-existing CI failure, tell the owner and start a separate fix round at once.
- Never wait for Renovate. Once your own release's image is published, bump its tag and digest yourself where it's deployed. For anything else, tick the update's box in the repo's `Renovate Dashboard` issue (else `manual job`) by editing the line from `- [ ]` to `- [x]` and piping the body to `gh issue edit <n> --body-file -` (no Write tool), then have a `chore-runner` poll for the PR.

## Review and readiness

**Size checks to risk.** Before each check (a reviewer or lens, a fix-check, `spec-review`, a validator), name what it can catch that the checks already run can't. If nothing, skip it and give the reason in one line of your report.

- **High risk** - the change can take production down, lose or delete data, or weaken security. It gets every check; skip none.
- **Low risk** - anything else gets the one cheapest check that covers it. A small no-logic change from Routing needs only your own `git diff`, unless a repo rule requires a reviewer. Post-push validators the repo's rules name still run: nothing before the push sees the live result.
- **Unsure** - treat it as high risk.
- The repo's local orchestration rule names its high-risk areas and any validator that counts as a reviewer there.

When a change needs a reviewer, use a fresh one, never the author; verbatim step 3 fixes and bot PRs (your checks under Owner) need none. Security-sensitive changes get an attacker-minded brief. Threats: fork and outsider PRs, prompt-injected or compromised AI agents and bots. Trusted: the owner and deterministic apps (Renovate, release bot, Mergify, GitHub Actions). Grade a security finding by what an attacker gains that existing controls don't already stop, and drop it if that's nothing.

**Push first, review at green.** The builder pushes PR work and fixes CI, CodeQL and Sonar until green; reviews and fix-checks then run on that CI-green head, and no helper is briefed to predict scanner findings. If a job waits for the owner's approval, review that head first and ask for the approval only once the review has no BLOCKER or MAJOR.

**Review first** (READY on the local, unpushed commit): (a) pushes straight to `main` in trunk-based repos; (b) CI workflow files (`.github/workflows/`); (c) security work: text, code, tests or commits that describe what a security control covers or misses (a PR page keeps every pushed commit, even after a squash); (d) review-gated paths the repo's rules define. CI fixes to that work are review-first too.

Review wide once, then check only the fixes: full re-reviews find new nits forever.

1. **Full review** - One fresh reviewer with no lens. Only high-risk work runs reviewers in parallel, one per lens: correctness, rules, and security when it applies. Merge their findings into one deduplicated list and re-grade it yourself: a MINOR that causes wrong behaviour (a bug, wrong output, lost data) is a MAJOR.
2. **Fix round** - One commit fixes every BLOCKER and MAJOR, plus each MINOR a reader or user would trip on or that breaks a repo convention; one such MINOR can start a round alone. Drop taste-only and unfixed MINORs, and never open follow-up issues for findings unless the owner asks.
3. **Fix-check** - A fresh reviewer in fix-check mode gets the list and the fix range and looks only there, though it still reports a BLOCKER it happens to see outside the range. Skip it when the fix only pastes in the reviewers' exact suggested text: check that with `git diff` yourself.
4. **Cap** - If BLOCKER or MAJOR findings remain after two review fix rounds, stop and take the list to the owner: repeat blockers usually mean the design is wrong. CI and scanner fix loops don't count.

Push review-first work and your own small changes yourself, from the `workspace.sh` clone that holds the commits and never the shared checkout, with `push-reviewed.sh <base> <sha> <branch>`, only once the review the change needs is READY on that exact range: every full-review lens or, after a fix round, the latest fix-check or your step 3 `git diff` check. If it stops, tell the owner. Give the pushed sha to the CI wait, and the range it prints to any post-push validator the repo's rules name.

**Definition of Ready**, before you approve, ask the owner to approve, or merge: that review is READY, owner comments and threads are checked, CI is green, and every gate the repo has passes.

## Owner

- Stay quiet while helpers run unless the owner must make a decision or do an owner-only step (UI, secrets, PR approvals). Offer 2 options at most, with a recommendation.
- Put the question first, with the full context to answer it there and clickable links; the owner is often on a phone.
- Re-check live state before listing an owner step, and check that review requests reached the owner.
- Approve a PR yourself only when `gh pr view <n> --json author` shows one of these logins; every other PR, including those you or your helpers opened, goes to the owner:
  - `app/renovate`: CI green, and the repo's Renovate triage skill, if it has one, returns SAFE; otherwise ask the owner.
  - `app/repo-operator-release-bot`: CI green, and the diff makes only release edits: `.release-please-manifest.json`, changelogs, version strings in the files release-please writes for each released package (its release type's version files and the `extra-files` in `release-please-config.json`; no dependency entries), and the one-line stamp in `megalinter-*/.rebuild-stamp` files.
- Once you approve one, merge it with `gh pr merge <n> --squash --repo <owner/repo>`. If branch rules block that, read its `Mergify Merge Protections` check and labels at once: when every protection passes and it has no `blocked` or `agent/needs-human-review` label, Mergify's queue merges it within minutes, so let it; otherwise report what blocks it.

## Improving this file

To change this file, reword, merge or delete a line rather than adding one.

Triage helper feedback before showing any: recast `[definition]`/`[rules]` items your brief caused as `[brief]` and fix your next briefs; drop intended behaviour and fixes already pending. Show the owner only items that cost something this session (a wrong result, an extra fix round, or a blocked helper) and that a change would stop recurring. Suggest a change when the owner corrects how you orchestrate, a helper round fails because a brief missed something, or the same `[brief]` gap shows up twice. Edit agent files, rules, `CLAUDE.md` or hooks only once the owner approves. Synced skills, rules and agents change in repo-operator `src/templates/.claude/...`, not in the repo's copy. Run `orchestration-retro` monthly or when asked.

## Session moves

On "wind down", start no new helpers until the owner says go.
