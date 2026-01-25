---
name: block-echo-subshell-secrets
enabled: true
event: bash
pattern: (echo|printf)\s+.*\$\((env|printenv|set)\b
action: block
---

🚫 **Blocked: Echo with command substitution that dumps environment**

**What was blocked:** `echo $(env)`, `echo $(printenv)`, or `echo $(set)` - these dump all environment variables including secrets.

**Why:** Command substitution captures the output of `env`/`printenv`/`set`, which contains all environment variable values.

**If you need specific information:**

1. **Check if a variable exists:**

   ```bash
   [ -n "$VAR_NAME" ] && echo "set" || echo "not set"
   ```

2. **List variable names only:**

   ```bash
   env | cut -d= -f1
   ```

3. **Ask the user** for specific variable values if needed.
