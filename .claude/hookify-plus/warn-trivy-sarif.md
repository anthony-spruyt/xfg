---
name: warn-trivy-sarif
enabled: true
event: bash
pattern: gh\s+run\s+view.*--log.*CVE|gh\s+run\s+view.*--log.*trivy|--log.*grep.*CVE|--log.*grep.*trivy
action: warn
warn_once: true
---

**[warn-trivy-sarif]** Trivy SARIF alerts live under `refs/pull/N/merge`, not source branch. Use the API instead of parsing logs:

```
gh api "repos/OWNER/REPO/code-scanning/alerts?ref=refs/pull/PR_NUMBER/merge&per_page=100" --jq '[.[] | select(.rule.security_severity_level == "critical" or .rule.security_severity_level == "high") | {number, rule: .rule.id, severity: .rule.security_severity_level, state: .state}]'
```
