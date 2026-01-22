# Prerequisites

xfg requires authentication with the Git platforms you're targeting. Each platform uses its official CLI tool.

## GitHub Authentication

Before using with GitHub repositories, authenticate with the GitHub CLI:

```bash
gh auth login
```

!!! note "Required Scopes"
Your token needs the `repo` scope to create PRs in target repositories.

## Azure DevOps Authentication

Before using with Azure DevOps repositories, authenticate with the Azure CLI:

```bash
az login
az devops configure --defaults organization=https://dev.azure.com/YOUR_ORG project=YOUR_PROJECT
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
