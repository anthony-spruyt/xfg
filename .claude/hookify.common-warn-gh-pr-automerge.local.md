---
name: warn-gh-pr-automerge
enabled: true
event: bash
pattern: gh\s+pr\s+create(\s|$)
action: warn
---

⚠️ **Reminder:** After creating the PR, enable automerge if the repo supports it: `gh pr merge --auto --squash --delete-branch`
