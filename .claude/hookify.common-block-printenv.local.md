---
name: block-printenv
enabled: false
event: bash
pattern: (^|\s|&&|\|\||;|\(|`)printenv(\s|$|\)|`)
action: block
---

🚫 **Blocked: Dumping environment variables**

**What was blocked:** `printenv` command (shows all environment variables with values)

**Why:** Environment variables often contain secrets, tokens, and credentials.

**If you need a specific variable:**

1. Ask the user: "What is the value of `$VARIABLE_NAME`?"
2. User can provide the value if it's safe to share

**Safe alternatives:**

- List variable names only: `printenv | cut -d= -f1`
- Check if variable exists: `[ -n "$VAR" ] && echo "set"`
- Get specific non-secret var: `echo $PATH`
