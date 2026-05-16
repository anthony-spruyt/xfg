---
name: block-ip-in-commits
enabled: true
event: bash
pattern: git\s+commit\b.*(?:(?:^|[^0-9])(?:10\.(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\.(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\.(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})|172\.(?:1[6-9]|2\d|3[01])\.(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\.(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})|192\.168\.(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\.(?:25[0-5]|2[0-4]\d|[01]?\d{1,2}))(?:/\d{1,2})?(?:[^0-9]|$))
action: block
---

🚫 **Blocked: Private IP/CIDR in commit message**

**What was blocked:** `git commit` with a message containing a private IP address or CIDR range.

**Why:** Commit messages are public artifacts. Private IPs (10.x.x.x, 172.16-31.x.x, 192.168.x.x) in commit messages expose internal network topology.

**Safe alternatives for commit messages:**

1. **Describe the change, not the value:**
   - ❌ `fix: update API endpoint to 192.168.20.11`
   - ✅ `fix: update API endpoint to use Flux substitution variable`

2. **Reference variable names:**
   - ❌ `chore: assign 10.244.0.0/16 as pod CIDR`
   - ✅ `chore: configure pod CIDR via cluster secrets`

**Note:** This hook only catches IPs in commit *messages*. The gitleaks pre-commit hook catches IPs in committed *file content*.

**False positive?** Open an issue: `gh issue create --repo anthony-spruyt/claude-config --title "False positive: block-ip-in-commits" --label bug` and describe the blocked command in the body using `--body-file` to avoid re-triggering hooks.
