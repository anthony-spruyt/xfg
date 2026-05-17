---
name: block-docs-plans-bash
enabled: true
event: bash
pattern: (^|[\s"'/])docs/(plans|superpowers)/
action: block
---

**BLOCKED: Wrong directory for plans/specs!**

You are trying to run a bash command that references `docs/plans/` or `docs/superpowers/` but this is the GitHub Pages directory. Writing here triggers a docs deploy.

**Use `plans/` instead** (in the repository root). For superpowers specs/plans, use `plans/superpowers/`.

Per CLAUDE.md:

> Do not commit plans or specs to `docs/` - that's GitHub Pages

Fix: Change your path from `docs/plans/...` to `plans/...` or `docs/superpowers/...` to `plans/superpowers/...`
