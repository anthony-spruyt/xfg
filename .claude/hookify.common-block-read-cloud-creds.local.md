---
name: block-read-cloud-creds
enabled: false
event: file
action: block
conditions:
  - field: file_path
    operator: regex_match
    pattern: [/\\]\.aws[/\\]credentials$|[/\\]\.kube[/\\]config$|kubeconfig|[/\\]\.docker[/\\]config\.json$|[/\\]\.config[/\\]gh[/\\]hosts\.yml$
---

**Blocked: Reading cloud credentials file**

**What was blocked:** AWS credentials, Kubernetes kubeconfig, Docker config, or GitHub CLI hosts file.

**Why:** These contain API keys, tokens, and cloud access credentials.

**Alternatives:**

- AWS: Use `aws sts get-caller-identity` to verify access
- Kubernetes: Use `kubectl config current-context` for context info
- Docker: Use `docker info` for registry status
