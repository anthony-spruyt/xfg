---
name: block-docs-plans
enabled: true
event: file
action: block
conditions:
  - field: file_path
    operator: regex_match
    pattern: docs/(plans|superpowers)/
---

**BLOCKED: Wrong directory for plans/specs!**

You are trying to create a file in `docs/plans/` or `docs/superpowers/` but this is the GitHub Pages directory. Writing here triggers a docs deploy.

**Use `plans/` instead** (in the repository root). For superpowers specs/plans, use `plans/superpowers/`.

Per CLAUDE.md:

> Do not commit plans or specs to `docs/` - that's GitHub Pages

Fix: Change your file path from `docs/plans/...` to `plans/...` or `docs/superpowers/...` to `plans/superpowers/...`
