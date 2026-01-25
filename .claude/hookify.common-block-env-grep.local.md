---
name: block-env-grep
enabled: true
event: bash
pattern: (env|printenv)\s*\|\s*grep
action: block
---

🚫 **Blocked: Searching environment variables**

**What was blocked:** `env | grep` or `printenv | grep`

**Why:** These commands search through ALL environment variables, which may contain secrets.

**If you need a specific variable:**

1. Ask the user: "What is the value of $VARIABLE_NAME?"
2. User can provide the value if it's safe
3. User can decline if it contains secrets

**Note:** This pattern is almost always used to search for credentials or tokens.

**Safe alternatives (these are NOT blocked):**

- List keys only: `env | cut -d= -f1` or `printenv | cut -d= -f1`
- Count variables: `env | wc -l`
- Check if key exists: `printenv VARNAME >/dev/null 2>&1 && echo "exists"`
