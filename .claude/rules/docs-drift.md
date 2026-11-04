---
paths: ['**/*.md']
---

# Docs That Drift

Documentation never holds a value someone must update by hand when a version or release changes: version numbers, build or release ids, image tags, digests, or lists of these copied from config. Point to the file or command that holds the value instead, e.g. "the supported builds are listed in `data/builds.json`".

This covers every doc: `CLAUDE.md`, READMEs, `docs/`, guides, and `.claude/` markdown.

A value that stays true when the thing updates is fine: a minimum version ("1.1.3 or newer"), a fixed historical fact, or one a bot keeps current (a `# renovate:` pin). A doc a repo rule keeps as a register is exempt.

When you touch a doc, replace any such value you find in it.
