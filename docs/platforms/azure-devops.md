# Azure DevOps

## URL Formats

| Format | Example                                                |
| ------ | ------------------------------------------------------ |
| SSH    | `git@ssh.dev.azure.com:v3/organization/project/repo`   |
| HTTPS  | `https://dev.azure.com/organization/project/_git/repo` |

## Authentication

```bash
az login
```

xfg passes `--org` to every `az` command, and `--project` to those that address a repository, so no `az devops configure` defaults are needed.

## Required Permissions

The user/service account needs "Contribute to pull requests" permission on the target repositories.

## Auto-Complete (Auto-Merge)

Azure DevOps calls it "auto-complete" instead of auto-merge. When enabled, the PR automatically completes when all policies pass.

| Merge Mode | Azure DevOps Behavior                                            |
| ---------- | ---------------------------------------------------------------- |
| `manual`   | Leave PR open for review                                         |
| `auto`     | Enable auto-complete (`az repos pr update --auto-complete true`) |
| `force`    | Bypass policies (`--bypass-policy true`)                         |

xfg passes a strategy flag to Azure DevOps only for `mergeStrategy: squash` (`--squash true`). `merge` and `rebase` add no flag, so `rebase` completes like `merge` (no squash).

## Bypass Reason

When using `merge: force`, xfg records a bypass reason with Azure DevOps. It defaults to `Automated config sync via xfg`; set `bypassReason` to override it:

```yaml
id: my-org-config
files:
  .prettierrc.json:
    content:
      semi: false

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

## Direct Push Mode

With `merge: direct`, xfg skips PR creation entirely and pushes directly to the default branch:

```yaml
id: my-org-config
files:
  .prettierrc.json:
    content:
      semi: false

prOptions:
  merge: direct

repos:
  - git: git@ssh.dev.azure.com:v3/org/project/repo
```

This is useful for repos without branch policies or when PR review isn't required. If the branch has policies that block direct pushes, the push will fail with a helpful error suggesting to use `merge: force` instead.

**When to use `direct` vs `force`:**

- `direct`: Repo has no branch policies, or you want to skip PR workflow entirely
- `force`: Repo has branch policies, but you have permissions to bypass them (creates a PR and completes with `--bypass-policy`)

## Supported Features

xfg syncs files to Azure DevOps repositories through pull requests. Settings (rulesets, labels, repo settings, code scanning, variables, collaborators, environments) and `xfg secrets sync` apply to GitHub repositories only; they are skipped for Azure DevOps repositories.

Repo lifecycle supports only GitHub as a target. An Azure DevOps repository that sets `upstream` or `source` fails: xfg logs the error, skips that repository's sync, syncs the remaining repositories, and exits non-zero at the end. An Azure DevOps repository can be the `source` of a migration into GitHub. See [Supported Platforms](../configuration/lifecycle.md#supported-platforms).
