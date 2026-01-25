---
name: block-read-env-files
enabled: true
event: file
action: block
conditions:
  - field: file_path
    operator: regex_match
    pattern: [/\\]\.env(\.[^/\\]+)?$
---

**Blocked: Reading environment file**

**What was blocked:** `.env` or `.env.*` files (e.g., `.env.local`, `.env.production`).

**Why:** Environment files typically contain API keys, database passwords, and other secrets.

**Alternatives:**

- Ask user which specific (non-sensitive) values they can share
- Use `.env.example` or `.env.template` as reference
- Read application config files for structure without secrets
