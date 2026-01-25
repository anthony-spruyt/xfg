---
name: block-age-decrypt
enabled: true
event: bash
pattern: age\s+(-d|--decrypt)
action: block
---

🚫 **Blocked: Age decryption**

**What was blocked:** `age -d` or `age --decrypt`

**Why:** Age-encrypted files typically contain sensitive secrets or credentials.

**If you need the decrypted content:**

1. Ask the user: "Can you decrypt this file and share the specific portion you need me to work with?"
2. User can decrypt manually: `age -d -i key.txt file.age`
3. User shares only the non-sensitive parts needed

**Safe alternatives:**

- Generate keys: `age-keygen -o key.txt`
- Encrypt (not decrypt): `age -r recipient -o file.age file`
- Get public key: `age-keygen -y key.txt`
