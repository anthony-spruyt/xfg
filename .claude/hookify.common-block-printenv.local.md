---
name: block-printenv
enabled: true
event: bash
# Lookahead: allow pipe to cut -d= -f1 (keys only) or wc (count only).
# -f1 boundary: require command terminator or pipe after -f1 — blocks trailing flags like --complement.
pattern: (^|\s|&&|\|\||;|\(|`)printenv([^\S\n]+[^\s|>]|[^\S\n]*($|;|&&|\|\||\)|`|([0-9]*|&)?>[^\S\n]*\S|\|[^\S\n]*(?![^\S\n]*(cut[^\S\n]+(-d=|--delimiter==)[^\S\n]+(-f1|--fields=1)([^\S\n]*($|;|&&|\|\||\)|`|\|))|wc([^\S\n]|$)))))
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

**False positive?** Open an issue: `gh issue create --repo anthony-spruyt/claude-config --title "False positive: block-printenv" --label bug` and describe the blocked command in the body using `--body-file` to avoid re-triggering hooks.
