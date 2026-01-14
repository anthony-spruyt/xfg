---
name: block-sops-decrypt
enabled: false
event: bash
pattern: sops\s+(-d|--decrypt|exec-env|exec-file)
action: block
---

🚫 **Blocked: SOPS decryption**

**What was blocked:** `sops -d`, `sops --decrypt`, `sops exec-env`, or `sops exec-file`

**Why:** These commands decrypt secrets, exposing them in:

- Process list / environment
- Shell history
- Terminal logs
- Temporary files

**If you need decrypted content:**

1. Ask the user: "Can you decrypt this file and share the specific value you need?"
2. User can run: `sops -d secrets.yaml` manually
3. User shares only the non-sensitive portions needed

**Safe alternatives:**

- View metadata: `sops --show-metadata file.yaml`
- Encrypt: `sops -e file.yaml`
- Update keys: `sops updatekeys file.yaml`
- Rotate keys: `sops -r file.yaml`
