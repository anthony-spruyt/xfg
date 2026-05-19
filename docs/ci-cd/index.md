# CI/CD Integration

Run xfg automatically when your config file changes.

## Supported CI Systems

- [GitHub Actions](github-actions.md)
- [Azure Pipelines](azure-pipelines.md)

## General Pattern

1. Trigger on changes to your config file
2. Install Node.js and xfg
3. Authenticate with the target platform
4. Run xfg

## Environment Variables

For CI/CD, you'll typically need:

| Platform     | Token Variable               | Notes                          |
| ------------ | ---------------------------- | ------------------------------ |
| GitHub       | `GH_TOKEN` or `GITHUB_TOKEN` | PAT with `repo` scope          |
| Azure DevOps | `AZURE_DEVOPS_EXT_PAT`       | Or use `$(System.AccessToken)` |
| GitLab       | `GITLAB_TOKEN`               | PAT with API access            |
