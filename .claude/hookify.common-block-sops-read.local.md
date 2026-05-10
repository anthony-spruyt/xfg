---
name: block-sops-read
enabled: true
event: file
action: block
conditions:
  - field: file_path
    operator: regex_match
    pattern: \.sops\.(yaml|yml|json)$
---

🚫 **Blocked: Reading SOPS encrypted file**

**What was blocked:** Reading `*.sops.yaml`, `*.sops.yml`, or `*.sops.json`

**Why:** These files contain encrypted secrets and are blocked in editor settings.

**If you need this:** Ask the user to:

- Share specific non-sensitive portions
- Decrypt manually if absolutely necessary

**False positive?** Open an issue: `gh issue create --repo anthony-spruyt/claude-config --title "False positive: block-sops-read" --label bug` and describe the blocked command in the body using `--body-file` to avoid re-triggering hooks.
