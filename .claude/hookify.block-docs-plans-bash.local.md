---
name: block-docs-plans-bash
enabled: true
event: bash
pattern: docs/plans
action: block
---

**BLOCKED: Wrong directory for plans!**

You are trying to run a bash command that references `docs/plans/` but this is the GitHub Pages directory.

**Use `plans/` instead** (in the repository root).

Per CLAUDE.md:

> Do not commit plans to `docs/` - that's GitHub Pages; use `plans/` for plans

Fix: Change your path from `docs/plans/...` to `plans/...`
