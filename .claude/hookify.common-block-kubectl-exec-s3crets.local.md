---
name: block-kubectl-exec-secrets
enabled: false
event: bash
pattern: kubectl\s+exec.*--\s+(cat\s+.*(secret|token|password|credential|\.pem|\.key|/var/run/secrets)|env\b|printenv)
action: block
---

🚫 **Blocked: kubectl exec reading secrets**

**What was blocked:** `kubectl exec` attempting to read secrets, credentials, or environment variables

**Dangerous patterns:**

- `kubectl exec ... cat /var/run/secrets/*` - Kubernetes service account tokens
- `kubectl exec ... cat *secret*` - Secret files
- `kubectl exec ... cat *token*` - Token files
- `kubectl exec ... cat *password*` - Password files
- `kubectl exec ... cat *.pem` - Private keys
- `kubectl exec ... env` - Environment variables (may contain secrets)
- `kubectl exec ... printenv` - Environment variables

**If you need this:** Ask the user to run the command manually or describe what information you need.

**Safe alternatives:**

- Check pod logs: `kubectl logs <pod>`
- Describe pod: `kubectl describe pod <pod>`
- Check configmaps: `kubectl get configmap <name> -o yaml`
