---
name: block-export-dump
enabled: true
event: bash
# Block export -p / export --print (dumps all exported variables with values)
# Allow: export VAR=value, export -n VAR
pattern: (^|\s|&&|\|\||;|\(|`)export[^\S\n]+(-[a-zA-Z]*p[a-zA-Z]*|--(print))([^\S\n]*$|[^\S\n]*\||[^\S\n]*;|[^\S\n]*&&|[^\S\n]*\|\||[^\S\n]*\)|[^\S\n]*`|[^\S\n]*([0-9]*|&)?>[^\S\n]*\S)
action: block
---

🚫 **Blocked: Dumping exported variables with `export -p`**

**What was blocked:** `export -p` (prints all exported variables with their values)

**Why:** This dumps ALL exported environment variables including secrets, tokens, and credentials.

**Safe alternatives:**

- List variable names only: `env | cut -d= -f1`
- Check if variable is exported: `declare -p VARNAME 2>/dev/null | grep -q 'declare -x' && echo "exported"`
- Check if variable exists: `[ -n "$VAR" ] && echo "set"`

**Note:** `export VAR=value`, `export -n VAR` and other export uses are allowed.

**False positive?** Open an issue: `gh issue create --repo anthony-spruyt/claude-config --title "False positive: block-export-dump" --label bug` and describe the blocked command in the body using `--body-file` to avoid re-triggering hooks.
