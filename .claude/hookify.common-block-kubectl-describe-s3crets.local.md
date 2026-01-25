---
name: block-kubectl-describe-secrets
enabled: true
event: bash
pattern: kubectl\s+describe\s+secrets?
action: block
---

🚫 **Blocked: kubectl describe secret**

**What was blocked:** `kubectl describe secret`

**Why:** This command outputs secret data (base64-encoded values) to stdout, which could:

- Appear in terminal history
- Be logged by shell recording
- Be accidentally shared in screenshots

**If you need this:** Ask the user to run the command manually.

**Safe alternatives:**

- List secret names: `kubectl get secrets`
- Check secret metadata: `kubectl get secret <name> -o jsonpath='{.metadata}'`
