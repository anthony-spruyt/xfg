---
name: warn-comment-density
enabled: true
event: file
action: warn
warn_once: true
conditions:
  - field: file_path
    operator: regex_match
    pattern: \.(ya?ml|json5|jsonc|tf|tfvars|hcl|sh|bash|py|go|ts|tsx|js|jsx|mjs|cjs|rs|rb|java|kt|swift|cs|c|h|cc|cpp|hpp|sql|toml|ini|cfg|conf|proto|gradle)$|(?:^|/)(?:Dockerfile|Makefile|Justfile|Taskfile)(?:[.\-][\w.\-]+)?$
  - field: new_text
    operator: regex_match
    pattern: (?:^|\n)[ \t]*(?:#(?!!)|//|--(?!-)|/\*)(?![ \t]*(?:renovate|yamllint|yaml-language-server|nolint|noqa|shellcheck|hadolint|checkov|tflint|gitleaks|eslint|biome-ignore|prettier-ignore|cspell|codespell|pylint|mypy|ruff|nosec|pragma|jscpd|trunk-ignore|go:generate|go:build|@?ts-|SPDX-|Copyright|region|endregion|MARK|type:|depName)\b)
---

**[warn-comment-density]** You are adding a comment to a code or config file.

The default in this repo is **no comment**. Before you write it, answer:

1. **Does this file already have comments?** The hook cannot see the file, only your edit. If the file has none, do not add the first one.
2. **Is it narration?** "Added X", "Now does Y", "Was 30s", "per user request" - delete it. Reasoning belongs in the commit body.
3. **Does it restate the line below?** Delete it.
4. **Is it longer than two lines?** Then it is not a comment. Put it in the commit body or a README.

Keep it only if it is a real footgun, a non-obvious constraint, a counter-intuitive choice, or a workaround with an upstream link - in one line, two at most.

While you are in this file: **delete any existing comment that fails the same test.** Comment debt does not get grandfathered.

Full rule: `.claude/rules/comments.md`
