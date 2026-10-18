# Platform Support

xfg supports GitHub, Azure DevOps, and GitLab (including self-hosted instances). The platform is detected from the git URL: `github.com`, `dev.azure.com` (and `ssh.dev.azure.com`) and `gitlab.com` are recognized directly, and hosts listed in [`githubHosts`](github.md#github-enterprise-server) are GitHub. Any other host with an `owner/repo` path is treated as a self-hosted GitLab instance, so a
GitHub Enterprise Server host missing from `githubHosts` is handled as GitLab.

## Supported Platforms

| Platform     | SSH URLs | HTTPS URLs | Self-Hosted                                                   |
| ------------ | -------- | ---------- | ------------------------------------------------------------- |
| GitHub       | Yes      | Yes        | Yes (via [`githubHosts`](github.md#github-enterprise-server)) |
| Azure DevOps | Yes      | Yes        | -                                                             |
| GitLab       | Yes      | Yes        | Yes                                                           |

## Feature Support

| Feature                                                                                                              | GitHub | Azure DevOps          | GitLab |
| -------------------------------------------------------------------------------------------------------------------- | ------ | --------------------- | ------ |
| File sync                                                                                                            | Yes    | Yes                   | Yes    |
| Settings (rulesets, labels, repo settings, code scanning, variables, collaborators, environments) and `secrets sync` | Yes    | -                     | -      |
| Repo lifecycle (create, fork, migrate)                                                                               | Yes    | Migration source only | -      |

Settings and secrets are skipped for repositories that are not on GitHub. See [Repo Lifecycle](../configuration/lifecycle.md#supported-platforms) for lifecycle operations per platform.

## Platform-Specific Details

- [GitHub](github.md) - SSH and HTTPS URL formats
- [GitHub App Authentication](github-app.md) - Verified commits for enterprise
- [Azure DevOps](azure-devops.md) - SSH and HTTPS URL formats
- [GitLab](gitlab.md) - SSH, HTTPS, nested groups, and self-hosted instances
