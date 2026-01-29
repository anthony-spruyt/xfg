# GitHub App Authentication

For enterprises that prefer GitHub Apps over personal access tokens (PATs).

## Benefits

- **No user-tied credentials** - App identity is separate from individual users
- **Fine-grained permissions** - Request only the permissions you need
- **Better audit trails** - All actions attributed to the app
- **Verified commits** - Commits signed by GitHub and show "Verified" badge

## Setup

### 1. Create a GitHub App

1. Go to your organization's settings > Developer settings > GitHub Apps
2. Click "New GitHub App"
3. Configure permissions:
   - **Repository permissions:**
     - Contents: Read and write
     - Pull requests: Read and write
   - **Where can this GitHub App be installed?** Only on this account
4. Create the app and note the **App ID**
5. Generate a **private key** (downloads a .pem file)

### 2. Install the App

1. Go to your app's settings > Install App
2. Select the repositories where xfg will sync configs

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
      - uses: actions/create-github-app-token@v2
        id: app-token
        with:
          app-id: ${{ vars.APP_ID }}
          private-key: ${{ secrets.APP_PRIVATE_KEY }}

      - uses: your-org/xfg-action@v2
        with:
          config: sync-config.yaml
          github-app-token: ${{ steps.app-token.outputs.token }}
```

## How It Works

When `GH_INSTALLATION_TOKEN` is set, xfg uses GitHub's GraphQL API (`createCommitOnBranch` mutation) instead of git commands for commits. This:

1. Creates commits that are automatically signed by GitHub
2. Shows the "Verified" badge on commits
3. Attributes commits to your GitHub App (e.g., `my-app[bot]`)

## Environment Variables

| Variable                | Auth Type  | Commit Method                                         |
| ----------------------- | ---------- | ----------------------------------------------------- |
| `GH_TOKEN`              | PAT        | `git commit` + `git push` (requires GPG for verified) |
| `GH_INSTALLATION_TOKEN` | GitHub App | GraphQL API (verified automatically)                  |

If both are set, `GH_INSTALLATION_TOKEN` takes precedence for GitHub repositories.

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
- The app is installed on the target repository

### Commits not showing as verified

Ensure you're using `GH_INSTALLATION_TOKEN`, not `GH_TOKEN`. Only installation tokens from GitHub Apps trigger the GraphQL verified commit flow.

### Payload too large

Files exceeding 50MB cannot be committed via the GraphQL API. Use `GH_TOKEN` (PAT authentication) for repositories with large files.
