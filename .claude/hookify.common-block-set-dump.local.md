---
name: block-set-dump
enabled: false
event: bash
pattern: (^|\s|&&|\|\||;|\(|`)set(\s*$|\s*\||\s*;|\s*&&|\s*\|\||\s*\)|\s*`)
action: block
---

🚫 **Blocked: Dumping shell variables with `set`**

**What was blocked:** The `set` command without arguments, which dumps ALL shell variables and functions including secrets.

**Why:** `set` outputs every variable in the shell environment, including sensitive values like tokens, passwords, and API keys.

**If you need to:**

1. **Check shell options:** `set -o` (lists option settings, not variables)
2. **Check if a variable is set:** `[ -n "$VAR" ] && echo "set"`
3. **List variable names only:** `compgen -v` or `env | cut -d= -f1`

**Note:** `set -e`, `set -x`, `set -o pipefail` and other option-setting uses are allowed.
