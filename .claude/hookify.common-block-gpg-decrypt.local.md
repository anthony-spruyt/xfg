---
name: block-gpg-decrypt
enabled: false
event: bash
pattern: gpg\s+(-d|--decrypt)
action: block
---

🚫 **Blocked: GPG decryption**

**What was blocked:** `gpg -d` or `gpg --decrypt`

**Why:** GPG-encrypted files typically contain sensitive secrets, keys, or credentials.

**If you need the decrypted content:**

1. Ask the user: "Can you decrypt this file and share the specific portion you'd like me to work with?"
2. User can decrypt manually: `gpg -d filename.gpg`
3. User shares only the non-sensitive parts needed

**Safe alternatives:**

- List recipients: `gpg --list-packets file.gpg`
- Verify signature: `gpg --verify file.sig`
- Encrypt (not decrypt): `gpg -e -r recipient file`
