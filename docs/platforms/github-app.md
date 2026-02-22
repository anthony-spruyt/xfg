# GitHub App Authentication

For enterprises that prefer GitHub Apps over personal access tokens (PATs).

## Benefits

- **No user-tied credentials** - App identity is separate from individual users
- **Fine-grained permissions** - Request only the permissions you need
- **Better audit trails** - All actions attributed to the app
- **Verified commits** - Commits signed by GitHub and show "Verified" badge
- **Multiple installations** - One GitHub App can be installed across multiple accounts

## Setup

### 1. Create a GitHub App

1. Go to your organization's settings > Developer settings > GitHub Apps
2. Click "New GitHub App"
3. Configure permissions:
   - **Repository permissions:**
     - Administration: Read and write _(required for repo lifecycle: create, archive, fork, etc.)_
     - Contents: Read and write
     - Pull requests: Read and write
     - Workflows: Read and write _(required if syncing `.github/workflows/` files)_
   - **Where can this GitHub App be installed?** Any account
4. Create the app and note the **App ID**
5. Generate a **private key** (downloads a .pem file)

### 2. Install the App

1. Go to your app's settings > Install App
2. Install the app in each organization where xfg will sync configs
3. Select the repositories the app can access (all or specific repos)

### 3. Store Credentials

In your GitHub repository:

- **Variables:** `APP_ID` (the numeric app ID)
- **Secrets:** `APP_PRIVATE_KEY` (contents of the .pem file)

### 4. Update Your Workflow

```yaml
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: anthony-spruyt/xfg@v3
        with:
          config: sync-config.yaml
          github-app-id: ${{ vars.APP_ID }}
          github-app-private-key: ${{ secrets.APP_PRIVATE_KEY }}
```

This approach:

- Discovers all installations of your GitHub App
- Generates short-lived tokens (1 hour) per-installation
- Caches tokens to minimize API calls
- Skips repositories without app access (with a warning)

## How It Works

When GitHub App credentials are provided, xfg:

1. **Generates a JWT** using your App ID and private key
2. **Discovers installations** by calling GitHub's API to list all installations
3. **Generates installation tokens** per-installation (tokens are cached for 55 minutes)
4. **Uses GraphQL API** for commits with the installation token, creating verified commits

This uses GitHub's `createCommitOnBranch` mutation instead of git commands, which:

- Creates commits that are automatically signed by GitHub
- Shows the "Verified" badge on commits
- Attributes commits to your GitHub App (e.g., `my-app[bot]`)

## Environment Variables

| Variable                     | Auth Type  | Description                              |
| ---------------------------- | ---------- | ---------------------------------------- |
| `XFG_GITHUB_APP_ID`          | GitHub App | App ID for installation token generation |
| `XFG_GITHUB_APP_PRIVATE_KEY` | GitHub App | Private key (PEM) for JWT signing        |
| `GH_TOKEN`                   | PAT        | Personal Access Token for GitHub API     |

When `XFG_GITHUB_APP_ID` and `XFG_GITHUB_APP_PRIVATE_KEY` are set, xfg uses GitHub App authentication with automatic per-installation token generation. For repositories without app access, xfg will skip processing with a warning.

> **Note:** You can also get verified commits with PATs by [configuring GPG signing](https://docs.github.com/en/authentication/managing-commit-signature-verification). GitHub App authentication is an alternative that doesn't require GPG key management.

## Limitations

1. **Commit author** - Commits appear as the GitHub App, not a custom user
2. **File size** - Large files (>50MB) should use PAT flow instead
3. **GHE compatibility** - Requires GitHub Enterprise Server 3.6+
4. **Atomic commits** - All file changes in a single commit

## Troubleshooting

### "Resource not accessible by integration"

The app lacks required permissions. Check that:

- Contents permission is set to "Read and write"
- Pull requests permission is set to "Read and write"
- Workflows permission is set to "Read and write" (if syncing `.github/workflows/` files)
- The app is installed on the target repository

> **Note:** The Workflows permission is required when syncing workflow files (`.github/workflows/`) because the `createCommitOnBranch` GraphQL mutation enforces this separately from the Contents permission. Without it, git push may succeed but the GraphQL commit will fail.

### Commits not showing as verified

Ensure you're using GitHub App authentication (`github-app-id` and `github-app-private-key` inputs). Only installation tokens from GitHub Apps trigger the GraphQL verified commit flow.

### Payload too large

Files exceeding 50MB cannot be committed via the GraphQL API. Use `GH_TOKEN` (PAT authentication) for repositories with large files.
