---
name: block-read-encrypted-stores
enabled: true
event: file
action: block
conditions:
  - field: file_path
    operator: regex_match
    pattern: [/\\]\.(gnupg|password-store)[/\\]
---

**Blocked: Reading encrypted password store**

**What was blocked:** GnuPG keyring files or pass password store files.

**Why:** These directories contain encrypted secrets and private keys.

**Alternatives:**

- Ask user what information they need from the password store
- Use `gpg --list-keys` to see available keys without exposing secrets

**False positive?** Open an issue: `gh issue create --repo anthony-spruyt/claude-config --title "False positive: block-read-encrypted-stores" --label bug` and describe the blocked command in the body using `--body-file` to avoid re-triggering hooks.
