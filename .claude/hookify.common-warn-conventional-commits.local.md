---
name: warn-conventional-commits
enabled: true
event: bash
pattern: git\s+commit\s
action: warn
warn_once: true
---

⚠️ **Reminder:** Use [Conventional Commits](https://www.conventionalcommits.org/) format: `<type>(<scope>): <description>`
