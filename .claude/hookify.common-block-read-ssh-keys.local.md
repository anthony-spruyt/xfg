---
name: block-read-ssh-keys
enabled: true
event: file
action: block
conditions:
  - field: file_path
    operator: regex_match
    pattern: (id_rsa|id_ed25519|id_ecdsa|\.pem|\.key|\.p12|\.pfx|\.jks|\.keystore)$|[/\\]\.ssh[/\\]
---

**Blocked: Reading SSH/PKI key file**

**What was blocked:** Private keys (RSA, Ed25519, ECDSA), certificates (.pem, .key, .p12, .pfx), Java keystores (.jks, .keystore), or SSH directory files.

**Why:** These files contain cryptographic secrets that should never be exposed.

**If you need certificate info:**

- Ask the user to share the public key or certificate details
- Request non-sensitive metadata only
