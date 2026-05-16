# Secrets

xfg can sync GitHub Actions secrets to your repositories using the `xfg secrets sync` command. Secrets are defined at the root level of your config file (not under `settings:`), and their values are read from environment variables at runtime. Secrets are configured at the root level only. Unlike variables, secrets cannot be defined per-repo or per-group.

!!! note "GitHub-Only Feature"
    Secrets are only available for GitHub repositories. Azure DevOps and GitLab repos will be skipped when running `xfg secrets sync`.

## Quick Start

```yaml
id: my-config

secrets:
  MY_API_KEY:
    env: MY_API_KEY_VALUE
  DATABASE_URL:
    env: DATABASE_URL_VALUE
  DEPLOY_TOKEN:
    env: DEPLOY_TOKEN_VALUE

repos:
  - git: git@github.com:your-org/your-repo.git
  - git: git@github.com:your-org/another-repo.git
```

```bash
# Preview changes (dry-run)
MY_API_KEY_VALUE=abc123 DATABASE_URL_VALUE=postgres://... DEPLOY_TOKEN_VALUE=tok_xyz \
  xfg secrets sync -c config.yaml --dry-run

# Apply secrets
MY_API_KEY_VALUE=abc123 DATABASE_URL_VALUE=postgres://... DEPLOY_TOKEN_VALUE=tok_xyz \
  xfg secrets sync -c config.yaml
```

## Secret Config

Each secret entry maps a secret name (as it will appear in GitHub) to a `SecretConfig` object:

| Field | Required | Description                                        |
| ----- | -------- | -------------------------------------------------- |
| `env` | Yes      | Name of the environment variable holding the value |

```yaml
secrets:
  MY_SECRET:
    env: MY_SECRET_VALUE   # Read from $MY_SECRET_VALUE at runtime
```

The secret name (`MY_SECRET`) is what gets created in GitHub Actions. The `env` field is the environment variable that xfg reads at runtime to get the actual secret value.

## Secret Naming Rules

Secret names must match `[A-Za-z_][A-Za-z0-9_]*` and may not start with `GITHUB_` (reserved by GitHub).

Valid examples:

```yaml
secrets:
  API_KEY:
    env: API_KEY_VALUE
  _INTERNAL_TOKEN:
    env: INTERNAL_TOKEN
```

Invalid examples (will be rejected):

```yaml
secrets:
  GITHUB_TOKEN:        # Reserved prefix
    env: TOKEN
  MY-SECRET:           # Hyphens not allowed
    env: SECRET
```

## Case-Insensitive Matching

Secret name matching is **case-insensitive** (GitHub treats secret names as case-insensitive). Defining `MY_SECRET` and `my_secret` in the same config is rejected as a duplicate. xfg normalizes names to uppercase when comparing against remote state.

## Environment Variable Requirements

Secret values are **never stored in your config file**. They are read from environment variables at runtime, so you must export them before running `xfg secrets sync`:

```bash
export MY_API_KEY_VALUE="the-actual-secret-value"
xfg secrets sync -c config.yaml
```

In CI/CD, inject secrets as environment variables to the step running xfg:

```yaml
# GitHub Actions example
- name: Sync secrets
  run: xfg secrets sync -c config.yaml
  env:
    MY_API_KEY_VALUE: ${{ secrets.MY_API_KEY_VALUE }}
    DATABASE_URL_VALUE: ${{ secrets.DATABASE_URL_VALUE }}
```

## Encryption

Secret values are encrypted using **libsodium sealed box encryption** before being sent to the GitHub API. xfg:

1. Fetches the repository's public key from GitHub
1. Encrypts the secret value using that public key (libsodium sealed box)
1. Uploads the encrypted value — GitHub decrypts it server-side

The plaintext value never leaves your environment unencrypted.

!!! warning "Security: Secret values are never logged"
    xfg never logs, prints, or stores secret values. Only secret names appear in output. If you see a secret value in output, please open an issue.

## Deleting Orphaned Secrets

When `deleteOrphaned: true` is set, secrets not present in the config will be deleted from the repository:

```yaml
secrets:
  deleteOrphaned: true
  MY_API_KEY:
    env: MY_API_KEY_VALUE
```

!!! danger
    `deleteOrphaned` deletes **all** secrets from the repository that are not defined in your config, including secrets created manually or by other tools. Use with caution.

## Dry Run Output

When running with `--dry-run`, xfg shows a plan of changes without applying them:

```text
[1/2] your-org/frontend: Secrets (dry-run)
  + MY_API_KEY
  + DATABASE_URL
  ~ DEPLOY_TOKEN (update)

[1/2] ✓ your-org/frontend: 2 created, 1 updated (dry-run)
```

Secret values are never shown in dry-run output — only the secret names.

## Secrets Sync Command

```bash
xfg secrets sync --config <path> [options]
```

| Option        | Alias | Description                                                       | Default      |
| ------------- | ----- | ----------------------------------------------------------------- | ------------ |
| `--config`    | `-c`  | Path to YAML config file                                          | **Required** |
| `--dry-run`   | `-d`  | Show what would be done without making changes                    | `false`      |
| `--retries`   | `-r`  | Number of retries for network operations                          | `3`          |
| `--no-delete` |       | Skip deletion of orphaned secrets even if `deleteOrphaned` is set | `false`      |

## GitHub API Reference

Secrets are managed via the [GitHub Actions Secrets API](https://docs.github.com/en/rest/actions/secrets):

- `GET /repos/{owner}/{repo}/actions/secrets` — List secrets (names only, not values)
- `GET /repos/{owner}/{repo}/actions/secrets/public-key` — Get encryption public key
- `PUT /repos/{owner}/{repo}/actions/secrets/{name}` — Create or update a secret
- `DELETE /repos/{owner}/{repo}/actions/secrets/{name}` — Delete a secret
