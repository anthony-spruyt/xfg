---
name: block-env-grep
enabled: true
event: bash
pattern: (^|\s|&&|\|\||;|\(|`)(env|printenv)[^\S\n]*\|[^\S\n]*grep
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
- Check if key exists: `[ -n "$VARNAME" ] && echo "exists"`

**False positive?** Open an issue: `gh issue create --repo anthony-spruyt/claude-config --title "False positive: block-env-grep" --label bug` and describe the blocked command in the body using `--body-file` to avoid re-triggering hooks.
