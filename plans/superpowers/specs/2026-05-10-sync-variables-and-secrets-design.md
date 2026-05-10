# Sync Repository CI Variables and Secrets

**Issue:** [#728](https://github.com/anthony-spruyt/xfg/issues/728) **Date:** 2026-05-10 **Scope:** GitHub-only, repository-level Actions variables and secrets

## Problem

xfg syncs files, labels, rulesets, and repo settings — but not CI variables or secrets. Credentials and configuration values needed by synced workflows must be manually added to each target repo.

## Solution

Two features with different sync lifecycles:

1. **Variables** — part of normal `xfg sync` settings flow
1. **Secrets** — separate `xfg secrets sync` command

### Why separate commands?

Secrets require env vars to be present at runtime (for libsodium encryption before GitHub API upload). This is an infrequent operation (rotation, new repos, new secrets). Coupling it to every `xfg sync` run would force operators to provide all secret env vars on every sync — unnecessary friction.

Variables are API-readable, diffable, and lightweight. They fit naturally alongside labels/rulesets in settings sync.

## Config Shape

```yaml
settings:
  variables:
    REGISTRY_URL: "ghcr.io"
    DEPLOY_ENV: "${DEPLOY_ENVIRONMENT}"
  deleteOrphaned: true

secrets:
  DEPLOY_TOKEN:
    env: DEPLOY_TOKEN_VALUE
  NPM_TOKEN:
    env: NPM_AUTH_TOKEN
  deleteOrphaned: true
```

- **Variables:** `name: value` string pairs. Values support existing `${ENV}` interpolation from config normalizer.
- **Secrets:** `name: { env: ENV_VAR_NAME }` — the `env` field names the environment variable to read at runtime. Value never written to config.
- **`deleteOrphaned`:** Independent flag per block. When true, target repo variables/secrets not in config are deleted.

## Architecture

### Variables (settings sync flow)

```text
VariablesProcessor (ISettingsProcessor)
  └─ IVariablesStrategy (injected)
       └─ GitHubVariablesStrategy
            list / create / update / delete
```

**Lifecycle:** `list()` current → diff against config → create / update / delete (if orphaned). Diff compares values — skip if unchanged.

**Files:**

- `src/settings/variables/processor.ts`
- `src/settings/variables/strategy.ts`
- `src/settings/variables/validator.ts`

### Secrets (own command)

```text
SecretsProcessor
  ├─ ISecretsStrategy (injected)
  │    └─ GitHubSecretsStrategy
  │         list / upsert / delete / getPublicKey
  └─ ISecretEncryptor (injected)
       └─ SodiumEncryptor
            encrypt(value, publicKey) → base64
```

**Lifecycle:**

- `list()` current names (values unreadable via API)
- Determine create vs update by name existence
- Always encrypt + upsert for every secret in config (can't diff values)
- Delete orphans by name if `deleteOrphaned: true`
- `--dry-run` lists what would change without needing env vars

**Encryption:** GitHub requires client-side libsodium sealed box encryption with the target repo's public key before PUT. Each target repo has its own public key. `ISecretEncryptor` interface enables test mocking.

**Files:**

- `src/secrets/processor.ts`
- `src/secrets/strategy.ts`
- `src/secrets/encryption.ts`
- `src/secrets/validator.ts`

### Shared

```text
IEnvResolver (injected into SecretsProcessor)
  └─ resolve(envName) → string | throw
```

**File:** `src/shared/env-resolver.ts`

## CLI

```bash
# Variables sync — part of existing settings sync
xfg sync --config config.yaml

# Secrets sync — separate command
xfg secrets sync --config config.yaml
xfg secrets sync --config config.yaml --dry-run
```

**Secrets behavior:**

- Resolves all env vars before any API calls — fails fast with list of missing vars
- Skip env resolution in `--dry-run`
- Per-repo: get public key → encrypt → upsert
- Single repo failure → report error, continue to next repo

## Validation

### Config-time

- Variable/secret names: alphanumeric + `_`, must not start with `GITHUB_`
- Variable values: must be strings (after env interpolation)
- Secret entries: must have `env` field (string)
- Variable and secret names must not overlap (GitHub enforces secrets taking precedence — catch early)
- Duplicate names caught at parse time

### Runtime (secrets only)

- All env vars resolved before any API calls — fail fast with list of all missing vars
- `--dry-run` skips env resolution entirely

## Error Handling

- Missing env var → hard error listing all missing vars (before touching any repo)
- Single repo API failure → report error, continue to next repo (matches file sync pattern)
- libsodium unavailable → error at startup with install instructions
- Summary in GitHub job summary output

## Testing

### Unit Tests

- `VariablesProcessor` — diff logic: create/update/delete/unchanged/dry-run, deleteOrphaned gating
- `SecretsProcessor` — upsert all in config, delete orphans, dry-run skips env resolution, missing env var fails fast
- `GitHubVariablesStrategy` — API call construction, response parsing
- `GitHubSecretsStrategy` — API calls including public key fetch
- `SodiumEncryptor` — encrypt/base64 output against known test vectors
- Config validation — name restrictions, missing `env` field, variable/secret name overlap

All collaborators injected via interfaces — strategies, encryptor, env resolver all mockable.

### Integration Tests

Extend `npm run test:integration:github` suite:

- Variables: create, update value, delete orphan, dry-run
- Secrets: create, verify exists (can't verify value), delete orphan, dry-run

## Dependencies

- `libsodium-wrappers` npm package for sealed box encryption (`tweetsodium` is deprecated in favor of this)
