---
name: warn-code-scanning-ref
enabled: true
event: bash
action: warn
warn_once: true
mask_data: true
conditions:
  - field: command
    operator: command_match
    pattern: '^gh\s+api\b(?!.*refs/pull/).*code-scanning/alerts(?![/\w])'
    fallback: '(?:^|[;&|]\s*)gh\s+api\b(?!.*refs/pull/).*code-scanning/alerts(?![/\w])'
---

**[warn-code-scanning-ref]** Code-scanning SARIF alerts are indexed under the merge ref, not the source branch. Without `ref=refs/pull/N/merge`, the API returns 404.

Correct usage:

```bash
gh api "repos/OWNER/REPO/code-scanning/alerts?ref=refs/pull/PR_NUMBER/merge&per_page=100" --jq '[.[] | select(.rule.security_severity_level == "critical" or .rule.security_severity_level == "high") | {number, rule: .rule.id, severity: .rule.security_severity_level, state: .state}]'
```
