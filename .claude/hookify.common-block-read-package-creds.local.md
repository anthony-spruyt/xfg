---
name: block-read-package-creds
enabled: true
event: file
action: block
conditions:
  - field: file_path
    operator: regex_match
    pattern: [/\\]\.(npmrc|pypirc|netrc)$
---

**Blocked: Reading package manager credentials**

**What was blocked:** `.npmrc`, `.pypirc`, or `.netrc` files.

**Why:** These contain authentication tokens for npm, PyPI, or network services.

**Alternatives:**

- npm: Check `npm whoami` for auth status
- Ask user about registry configuration (not tokens)
