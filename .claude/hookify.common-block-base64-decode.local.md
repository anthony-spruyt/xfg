---
name: block-base64-decode
enabled: false
event: bash
pattern: base64\s+(-d|--decode|-D)
action: block
---

🚫 **Blocked: Base64 decoding**

**What was blocked:** `base64 -d`, `base64 --decode`, or `base64 -D`

**Why:** Base64 decoding is often used to extract encoded secrets, tokens, or credentials.

**If you need the decoded value:**

1. Ask the user: "Can you decode this base64 string and share the result if it's not sensitive?"
2. Provide the encoded string for them to decode
3. User can share the result or decline if it contains secrets

**Common scenarios:**

- Kubernetes secrets: Ask user to run `kubectl get secret X -o jsonpath='{.data.Y}' | base64 -d`
- Config values: Ask user to decode and share non-sensitive portions
