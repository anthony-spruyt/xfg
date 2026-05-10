---
name: block-declare-dump
enabled: true
event: bash
# Block declare -p / declare --print (dumps all variables with values)
# Allow: declare -x, declare -i VAR, declare -a ARR, declare -f (functions only)
pattern: (^|\s|&&|\|\||;|\(|`)(declare|typeset)[^\S\n]+(-[a-zA-Z]*p[a-zA-Z]*|--(print))([^\S\n]*$|[^\S\n]*\||[^\S\n]*;|[^\S\n]*&&|[^\S\n]*\|\||[^\S\n]*\)|[^\S\n]*`|[^\S\n]*([0-9]*|&)?>[^\S\n]*\S|[^\S\n]+--[^\S\n]*$|[^\S\n]+--[^\S\n]*[|;)])
action: block
---

🚫 **Blocked: Dumping variables with `declare -p`**

**What was blocked:** `declare -p` or `typeset -p` (prints all variables with their values)

**Why:** This dumps ALL shell variables including secrets, tokens, and credentials.

**Safe alternatives:**

- List variable names only: `compgen -v`
- Check if variable exists: `[ -n "$VAR" ] && echo "set"`
- Check variable type: `declare -p VARNAME 2>/dev/null | cut -d= -f1`

**Note:** `declare -x`, `declare -i VAR=1`, `declare -a ARR` and other declaration uses are allowed.

**False positive?** Open an issue: `gh issue create --repo anthony-spruyt/claude-config --title "False positive: block-declare-dump" --label bug` and describe the blocked command in the body using `--body-file` to avoid re-triggering hooks.
