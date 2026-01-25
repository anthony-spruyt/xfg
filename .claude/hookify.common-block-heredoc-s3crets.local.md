---
name: block-heredoc-secrets
enabled: true
event: bash
pattern: <<-?\s*["']?\w+["']?[\s\S]*\$\{?[A-Za-z_][A-Za-z0-9_]*(_PAT|TOKEN|SECRET|PASSWORD|PASSPHRASE|CREDENTIAL|PRIVATE_KEY|API_KEY|SECRET_KEY|ACCESS_KEY)\b
action: block
---

🚫 **Blocked: Heredoc referencing sensitive environment variable**

**What was blocked:** A heredoc (`<<EOF`) containing a reference to a variable that appears to contain secrets.

**Why:** Heredocs expand variables by default, which would expose the secret value in the output.

**Safe alternative using quoted delimiter:**

```bash
# Single-quoted delimiter PREVENTS variable expansion:
cat <<'EOF'
Token check: $SECRET_TOKEN will NOT expand
EOF
```

**If you need to check if a variable is set:**

```bash
[ -n "$VAR_NAME" ] && echo "set" || echo "not set"
```
