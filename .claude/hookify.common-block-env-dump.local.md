---
name: block-env-dump
enabled: true
event: bash
pattern: (^|\s|&&|\|\||;|\(|`)env\s*($|\||;|&&|\|\||\)|`)
action: block
---

🚫 **Blocked: Dumping environment variables**

**What was blocked:** `env` command (shows all environment variables with values)

**Why:** Environment variables often contain secrets, tokens, and credentials.

**If you need a specific variable:**

1. Ask the user: "What is the value of `$VARIABLE_NAME`?"
2. User can provide the value if it's safe to share

**Safe alternatives:**

- List variable names only: `env | cut -d= -f1`
- Check if variable exists: `[ -n "$VAR" ] && echo "set"`
- Get specific non-secret var: `echo $PATH`
