# Secrets

xfg can sync GitHub Actions secrets to your repositories using the `xfg secrets sync` command. Secrets live under `settings:` and their values are read from environment variables at runtime. Like variables, they can be scoped at the root, group, conditional-group, and per-repo level.

Secrets are **never** touched by a plain `xfg sync` — only `xfg secrets sync` reads them.

!!! note "GitHub-Only Feature"
    Secrets are only available for GitHub repositories. Azure DevOps and GitLab repos will be skipped when running `xfg secrets sync`.

## Quick Start

```yaml
id: my-config

settings:
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
settings:
  secrets:
    MY_SECRET:
      env: MY_SECRET_VALUE   # Read from $MY_SECRET_VALUE at runtime
```

The secret name (`MY_SECRET`) is what gets created in GitHub Actions. The `env` field is the environment variable that xfg reads at runtime to get the actual secret value.

## Scoping Secrets

Secrets merge through the same layers as variables: root → group → conditional group → repo. Innermost wins.

```yaml
id: my-config

settings:
  secrets:
    SHARED_KEY:
      env: SHARED_KEY_VALUE

groups:
  frontend:
    settings:
      secrets:
        NPM_TOKEN:
          env: NPM_TOKEN_VALUE

repos:
  # Gets SHARED_KEY and NPM_TOKEN
  - git: git@github.com:your-org/web.git
    groups: [frontend]

  # Gets SHARED_KEY only
  - git: git@github.com:your-org/api.git

  # Gets DEPLOY_KEY only — inherit: false discards everything above
  - git: git@github.com:your-org/isolated.git
    groups: [frontend]
    settings:
      secrets:
        inherit: false
        DEPLOY_KEY:
          env: ISOLATED_DEPLOY_KEY

  # Gets nothing — SHARED_KEY is opted out by name
  - git: git@github.com:your-org/legacy.git
    settings:
      secrets:
        SHARED_KEY: false
```

| Directive        | Effect                                                             |
| ---------------- | ------------------------------------------------------------------ |
| `inherit: false` | Discard every inherited secret at this layer                       |
| `NAME: false`    | Opt out of one inherited secret                                    |
| `deleteOrphaned` | Policy switch, innermost wins — `inherit: false` does not clear it |

`deleteOrphaned` is a policy switch, not an entry. `inherit: false` discards inherited *entries* but leaves an inherited `deleteOrphaned` in place. To turn cleanup off for a repo, set `deleteOrphaned: false` explicitly.

!!! danger "`inherit: false` plus `deleteOrphaned: true` deletes inherited secrets"
    `inherit: false` makes inherited secrets *undesired*, and `deleteOrphaned` removes undesired secrets. Together they delete those secrets from the repo, as in the example below. That is correct behaviour, but the interaction is easy to miss — run `--dry-run` first.

```yaml
settings:
  secrets:
    SHARED_KEY:
      env: SHARED

repos:
  - git: git@github.com:org/isolated.git
    settings:
      secrets:
        inherit: false          # SHARED_KEY is no longer desired here
        deleteOrphaned: true    # ...so it gets deleted from the repo
        OWN_KEY:
          env: OWN
```

## Secret Naming Rules

Secret names must match `[A-Za-z_][A-Za-z0-9_]*` and may not start with `GITHUB_` (reserved by GitHub).

Valid examples:

```yaml
settings:
  secrets:
    API_KEY:
      env: API_KEY_VALUE
    _INTERNAL_TOKEN:
      env: INTERNAL_TOKEN
```

Invalid examples (will be rejected):

```yaml
settings:
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
  uses: anthony-spruyt/xfg@v7 # x-release-please-major
  with:
    command: secrets-sync
    config: config.yaml
    github-client-id: ${{ vars.APP_CLIENT_ID }}
    github-app-private-key: ${{ secrets.APP_PRIVATE_KEY }}
  env:
    MY_API_KEY_VALUE: ${{ secrets.MY_API_KEY_VALUE }}
    DATABASE_URL_VALUE: ${{ secrets.DATABASE_URL_VALUE }}
```

## Authentication

With `XFG_GITHUB_CLIENT_ID` and `XFG_GITHUB_APP_PRIVATE_KEY` set, `xfg secrets sync` mints a GitHub App token per repo owner. A repo whose owner has no installation **fails** the run, so a missed rotation is never silent. Without app credentials it uses `GH_TOKEN`, then `GITHUB_TOKEN`. See [GitHub App](../platforms/github-app.md).

The app needs the **Secrets: Read and write** repository permission.

## Encryption

Secret values are encrypted using **libsodium sealed box encryption** before being sent to the GitHub API. xfg:

1. Fetches the repository's public key from GitHub
2. Encrypts the secret value using that public key (libsodium sealed box)
3. Uploads the encrypted value — GitHub decrypts it server-side

The plaintext value never leaves your environment unencrypted.

!!! warning "Security: Secret values are never logged"
    xfg never logs, prints, or stores secret values. Only secret names appear in output. If you see a secret value in output, please open an issue.

## Deleting Orphaned Secrets

When `deleteOrphaned: true` is set, secrets not present in the config will be deleted from the repository:

```yaml
settings:
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

See [CLI Options — Secrets Sync Command](../reference/cli-options.md#secrets-sync-command) for the full option list.

## GitHub API Reference

Secrets are managed via the [GitHub Actions Secrets API](https://docs.github.com/en/rest/actions/secrets):

- `GET /repos/{owner}/{repo}/actions/secrets` — List secrets (names only, not values)
- `GET /repos/{owner}/{repo}/actions/secrets/public-key` — Get encryption public key
- `PUT /repos/{owner}/{repo}/actions/secrets/{name}` — Create or update a secret
- `DELETE /repos/{owner}/{repo}/actions/secrets/{name}` — Delete a secret
