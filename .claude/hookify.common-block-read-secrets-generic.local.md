---
name: block-read-secrets-generic
enabled: true
event: file
action: block
conditions:
  - field: file_path
    operator: regex_match
    pattern: (secrets?\.(ya?ml|json|txt)|tokens?\.(json|txt)|\.credentials$|credentials\.json$|\.htpasswd$|\.vault-token$)
---

**Blocked: Reading potential secrets file**

**What was blocked:** Files named `secrets.yaml`, `token.json`, `credentials.json`, `.htpasswd`, `.vault-token`, or similar secret storage files.

**Why:** These filenames indicate sensitive credential storage.

**Alternatives:**

- Ask user to share specific non-sensitive portions
- Use configuration templates or examples instead
