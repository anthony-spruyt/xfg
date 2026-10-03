---
name: warn-trivy-sarif
enabled: true
event: bash
action: warn
warn_once: true
mask_data: true
conditions:
  - field: command
    operator: command_match
    pattern: '^gh\s+run\s+view\b.*--log.*(cve|trivy)'
    fallback: 'gh\s+run\s+view.*--log.*(cve|trivy)|--log.*grep.*(cve|trivy)'
---

**[warn-trivy-sarif]** Trivy SARIF alerts live under `refs/pull/N/merge`, not source branch. Use the API instead of parsing logs:

```bash
gh api "repos/OWNER/REPO/code-scanning/alerts?ref=refs/pull/PR_NUMBER/merge&per_page=100" --jq '[.[] | select(.rule.security_severity_level == "critical" or .rule.security_severity_level == "high") | {number, rule: .rule.id, severity: .rule.security_severity_level, state: .state}]'
```
