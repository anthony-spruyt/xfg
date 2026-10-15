---
name: orchestration-retro
description: >
  Review how helper delegation went from the Claude Code session logs. Use when the owner asks for an orchestration retro or to review
  how helpers or delegation went, and about monthly.
---

# Orchestration Retro

Report to the owner only; never post it to GitHub.

## 1. Run the report

```bash
.claude/skills/orchestration-retro/retro.sh --since "$(date -d '30 days ago' +%F)"
```

Use another `--since` date if the owner names a window. The script is read-only and prints helper counts and output tokens per agent type and model, general-purpose helpers that ran on Opus, review verdicts, fix rounds per PR (fix-check reviews), and non-None `### Agent Definition Feedback`, with `[definition]`, `[rules]` and `[brief]` items counted and listed separately.

## 2. Read it

- Routing: general-purpose helpers on Opus mean a brief should have named `builder`, `reviewer` or `chore-runner`, or a rule or agent description is unclear.
- Over-delegation: many `chore-runner` runs with a low output-token total (under ~1k per run, total divided by runs in the agent table), or `[brief]` feedback from `chore-runner` saying the job was trivial, means short jobs are being handed off against the `orchestration` skill's Routing section.
- Rework: a PR with a fix round means the full review or the builder's self-review missed something; two (at cap) point to a gap in the brief or design.
- Feedback: `[definition]` and `[rules]` entries not yet applied to the agent file, `CLAUDE.md` or rules file; `[brief]` entries repeated across runs point to a gap in the `orchestration` skill.

## 3. Propose changes

Propose up to 5 one-line changes to the `orchestration` skill or an agent file. They land in repo-operator `src/templates/.claude/skills/orchestration/SKILL.md` or `src/templates/.claude/agents/*.md`, not in the repo's synced copy. Tie each to the report line that supports it.

Change nothing until the owner approves.
