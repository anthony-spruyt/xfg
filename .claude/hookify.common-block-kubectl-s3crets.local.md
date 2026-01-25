---
name: block-kubectl-secrets
enabled: true
event: bash
pattern: kubectl\s+get\s+secrets?\s+.*(-o\s+(yaml|json|jsonpath|go-template)|--output[=\s]+(yaml|json|jsonpath|go-template))
action: block
---

🚫 **Blocked: kubectl get secret with output format**

**What was blocked:** `kubectl get secret -o yaml/json/jsonpath/go-template` or `--output yaml/json/jsonpath/go-template`

**Why:** These commands output base64-encoded secrets to stdout, which could:

- Appear in terminal history
- Be logged by shell recording
- Be accidentally shared in screenshots

**If you need this:** Ask the user to run the command manually.
