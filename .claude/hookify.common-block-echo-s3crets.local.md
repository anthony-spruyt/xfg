---
name: block-echo-secrets
enabled: true
event: bash
pattern: (echo|printf)\s+.*\$\{?[A-Za-z_]*(_PAT|TOKEN|SECRET|PASSWORD|PASSPHRASE|CREDENTIAL|PRIVATE_KEY|API_KEY|SECRET_KEY|ACCESS_KEY)\b
action: block
---

🚫 **Blocked: Echoing sensitive environment variable**

**What was blocked:** `echo` or `printf` referencing a variable that appears to contain secrets (PAT, TOKEN, SECRET, PASSWORD, KEY, CREDENTIAL)

**Why:** This would expose the secret value in the output. Even "safe" patterns like `${VAR:-NOT SET}` leak the value when the variable is set.

**The problem with your command:**

```bash
# This LEAKS the secret when VAR is set:
echo "${VAR:+set (hidden)}${VAR:-NOT SET}"
#                         ^^^^^^^^^^^^^^^^
#                         This prints the actual value!
```

**Safe alternatives:**

1. **Check if set without revealing value:**

   ```bash
   [ -n "$VAR_NAME" ] && echo "set" || echo "not set"
   ```

2. **Ask the user directly:**
   "Is the environment variable `VAR_NAME` set?"

3. **Use printenv with existence check only:**
   ```bash
   printenv VAR_NAME >/dev/null 2>&1 && echo "set" || echo "not set"
   ```

**Never use these patterns - they ALL leak secrets:**

- `echo $SECRET_TOKEN`
- `echo "${TOKEN}"`
- `echo "${VAR:-default}"` (leaks when set)
- `printf "%s" "$PASSWORD"`
