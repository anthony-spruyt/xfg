---
name: block-docs-plans
enabled: true
event: file
action: block
conditions:
  - field: file_path
    operator: regex_match
    pattern: docs/plans/
---

**BLOCKED: Wrong directory for plans!**

You are trying to create a file in `docs/plans/` but this is the GitHub Pages directory.

**Use `plans/` instead** (in the repository root).

Per CLAUDE.md:

> Do not commit plans to `docs/` - that's GitHub Pages; use `plans/` for plans

Fix: Change your file path from `docs/plans/...` to `plans/...`
