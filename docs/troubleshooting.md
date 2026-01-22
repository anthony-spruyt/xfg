# Troubleshooting

## Authentication Errors

### GitHub

```bash
# Check authentication status
gh auth status

# Re-authenticate if needed
gh auth login
```

### Azure DevOps

```bash
# Check authentication status
az account show

# Re-authenticate if needed
az login
az devops configure --defaults organization=https://dev.azure.com/YOUR_ORG
```

### GitLab

```bash
# Check authentication status
glab auth status

# Re-authenticate if needed
glab auth login

# For self-hosted instances
glab auth login --hostname gitlab.example.com
```

## Permission Denied

- Ensure your token has write access to the target repositories
- For GitHub, the token needs `repo` scope
- For Azure DevOps, ensure the user/service account has "Contribute to pull requests" permission
- For GitLab, ensure the user has at least "Developer" role on the project

## Branch Already Exists

The tool uses a fresh-start approach: it closes any existing PR on the branch and deletes the branch before creating a new one. This ensures each sync attempt is isolated and avoids merge conflicts from stale branches.

If you see issues with stale branches:

```bash
# Manually delete the remote branch if needed
git push origin --delete chore/sync-config
```

## Missing Environment Variables

If you see "Missing required environment variable" errors:

```bash
# Set the variable before running
export MY_VAR=value
xfg --config ./config.yaml

# Or use default values in config
# ${MY_VAR:-default-value}
```

## Network/Proxy Issues

If cloning fails behind a corporate proxy:

```bash
# Configure git proxy
git config --global http.proxy http://proxy.example.com:8080
git config --global https.proxy http://proxy.example.com:8080
```

## Transient Network Errors

The tool automatically retries transient errors (timeouts, connection resets, rate limits) with exponential backoff. By default, it retries 3 times before failing.

```bash
# Increase retries for unreliable networks
xfg --config ./config.yaml --retries 5

# Disable retries
xfg --config ./config.yaml --retries 0
```

Permanent errors (authentication failures, permission denied, repository not found) are not retried.
