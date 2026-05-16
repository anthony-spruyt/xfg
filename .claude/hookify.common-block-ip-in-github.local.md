---
name: block-ip-in-github
enabled: true
event: bash
pattern: gh\s+(issue|pr)\s+(create|comment|edit)\b.*(?:(?:^|[^0-9])(?:10\.(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\.(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\.(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})|172\.(?:1[6-9]|2\d|3[01])\.(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\.(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})|192\.168\.(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\.(?:25[0-5]|2[0-4]\d|[01]?\d{1,2}))(?:/\d{1,2})?(?:[^0-9]|$))
action: block
---

🚫 **Blocked: Private IP/CIDR in GitHub issue or PR**

**What was blocked:** `gh issue/pr create/comment/edit` containing a private IP address or CIDR range.

**Why:** Private IPs (10.x.x.x, 172.16-31.x.x, 192.168.x.x) must never appear in GitHub issues, PRs, or comments. These are public artifacts that expose internal network topology.

**Safe alternatives:**

1. **Use generic descriptions instead of IPs:**
   - ❌ `node at 192.168.20.11 is unreachable`
   - ✅ `control plane node E2-1 is unreachable`

2. **Reference file paths instead of values:**
   - ❌ `updated CIDR to 10.244.0.0/16`
   - ✅ `updated pod CIDR in cluster-secrets.sops.yaml`

3. **Use substitution variable names:**
   - ❌ `Traefik LoadBalancer IP: 192.168.20.100`
   - ✅ `Traefik LoadBalancer uses ${TRAEFIK_IP4} substitution`

**False positive?** Open an issue: `gh issue create --repo anthony-spruyt/claude-config --title "False positive: block-ip-in-github" --label bug` and describe the blocked command in the body using `--body-file` to avoid re-triggering hooks.
