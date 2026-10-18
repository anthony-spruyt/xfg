# Prerequisites

xfg requires authentication with the Git platforms you're targeting. Each platform uses its official CLI tool.

## GitHub Authentication

Before using with GitHub repositories, authenticate with the GitHub CLI:

```bash
gh auth login
```

For GitHub Enterprise Server instances:

```bash
gh auth login --hostname github.mycompany.com
```

xfg sends GitHub credentials only to github.com, unless the host is listed in `XFG_ALLOWED_GITHUB_HOSTS`:

```bash
export XFG_ALLOWED_GITHUB_HOSTS="github.mycompany.com"
```

Also list the host in `githubHosts` in the config. See [GitHub Enterprise Server](../platforms/github.md#ghe-authentication).

!!! note "Required Scopes"
    A classic token needs the `repo` scope to create PRs in target repositories. To sync files under `.github/workflows/`, it also needs the `workflow` scope.

## Azure DevOps Authentication

Before using with Azure DevOps repositories, authenticate with the Azure CLI:

```bash
az login
```

!!! note "Required Permissions"
    Ensure the user/service account has "Contribute to pull requests" permission.

## GitLab Authentication

Before using with GitLab repositories, authenticate with the GitLab CLI:

```bash
glab auth login
```

For self-hosted GitLab instances:

```bash
glab auth login --hostname gitlab.example.com
```

!!! note "Required Permissions"
    Ensure the user has at least "Developer" role on the project.
