# Azure DevOps

## URL Formats

| Format | Example                                                |
| ------ | ------------------------------------------------------ |
| SSH    | `git@ssh.dev.azure.com:v3/organization/project/repo`   |
| HTTPS  | `https://dev.azure.com/organization/project/_git/repo` |

## Authentication

```bash
az login
az devops configure --defaults organization=https://dev.azure.com/YOUR_ORG project=YOUR_PROJECT
```

## Required Permissions

The user/service account needs "Contribute to pull requests" permission on the target repositories.

## Auto-Complete (Auto-Merge)

Azure DevOps calls it "auto-complete" instead of auto-merge. When enabled, the PR automatically completes when all policies pass.

| Merge Mode | Azure DevOps Behavior                                            |
| ---------- | ---------------------------------------------------------------- |
| `manual`   | Leave PR open for review                                         |
| `auto`     | Enable auto-complete (`az repos pr update --auto-complete true`) |
| `force`    | Bypass policies (`--bypass-policy true`)                         |

## Bypass Reason

When using `merge: force`, Azure DevOps requires a bypass reason:

```yaml
repos:
  - git: git@ssh.dev.azure.com:v3/org/project/repo
    prOptions:
      merge: force
      bypassReason: "Automated config sync"
```

## PR Creation

xfg uses the `az repos pr` CLI commands to:

1. Create the PR
2. Enable auto-complete or bypass policies as configured
