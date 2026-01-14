---
name: block-sops-read
enabled: false
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
