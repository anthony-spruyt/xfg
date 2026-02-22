# Secret Rotation

Rotate credentials used by xfg regularly to limit the blast radius of a compromise.

## Recommended Schedules

| Credential | Recommended Schedule |
| --- | --- |
| GH_TOKEN (GitHub PAT) | Every 90 days |
| GitHub App private key (.pem) | Every 6 months |
| Azure DevOps PAT / service principal | Every 90 days |
| GitLab PAT / project access token | Every 90 days |
| CONTEXT7_API_KEY / MCP keys | Per provider policy |

## GitHub PAT (GH_TOKEN)

1. Generate a new classic token at [GitHub Settings > Personal access tokens (classic)](https://github.com/settings/tokens) with `repo` and `workflow` scopes.

2. Update the secret in your CI environment:

   - **GitHub Actions:** Repository > Settings > Secrets and variables > Actions > Update `GH_TOKEN`
   - **Azure Pipelines:** Pipeline > Edit > Variables > Update `GH_TOKEN`
   - **GitLab CI:** Settings > CI/CD > Variables > Update `GH_TOKEN`

3. Trigger a test run to verify the new token works.

## GitHub App Private Key

1. Go to your GitHub App settings > General > Private keys.

2. Click **Generate a private key** to create a new `.pem` file.

3. Update the `APP_PRIVATE_KEY` secret in your CI environment with the contents of the new `.pem` file.

4. Trigger a test run to confirm xfg can authenticate with the new key.

5. Delete the old private key from the GitHub App settings page.

See [GitHub App Authentication](../platforms/github-app.md) for full setup details.

## Azure DevOps

### Azure DevOps PAT

1. Generate a new PAT in Azure DevOps > User Settings > Personal access tokens.

2. Update the token in your CI environment variables.

3. Verify with a test run.

### Service Principal

1. Rotate the client secret in Azure AD > App registrations > your app > Certificates & secrets.

2. Update the secret in your CI pipeline variables.

## GitLab

### GitLab PAT

1. Generate a new PAT in GitLab > User Settings > Access Tokens.

2. Update the token in your CI environment variables.

3. Verify with a test run.

### Project Access Token

1. Generate a new token in your project > Settings > Access Tokens.

2. Update the token in your CI/CD variables.

## Dev Environment Keys

For local development credentials (CONTEXT7_API_KEY, SSH keys, platform CLI sessions), see the [Secret Rotation section in DEVELOPMENT.md](https://github.com/anthony-spruyt/xfg/blob/main/DEVELOPMENT.md#secret-rotation).

## Post-Rotation Verification

After rotating any credential, run a dry-run sync to confirm xfg can authenticate without making changes:

```bash
xfg sync --config <config.yaml> --dry-run
```

Check the output for authentication errors before running a real sync.
