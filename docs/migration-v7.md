# Migrating from v6 to v7

v7 moves `secrets:` under `settings:`, so secrets can be scoped per group and per repo instead of being pushed to every repo in the config.

## Breaking Changes

### 1. Root-level `secrets:` moves under `settings:`

**Before (v6):**

```yaml
id: my-config

secrets:
  MY_KEY:
    env: MY_KEY_VALUE

repos:
  - git: git@github.com:org/web.git
  - git: git@github.com:org/api.git
```

**After (v7):**

```yaml
id: my-config

settings:
  secrets:
    MY_KEY:
      env: MY_KEY_VALUE

repos:
  - git: git@github.com:org/web.git
  - git: git@github.com:org/api.git
```

There is no back-compat shim. A root-level `secrets:` block produces:

```text
Root-level 'secrets' is no longer supported — move it under 'settings.secrets'.
Secrets can now also be scoped per group and per repo.
See https://anthony-spruyt.github.io/xfg/migration-v7/
```

!!! warning "Your editor will not flag this"
    The config schema's root object does not set `additionalProperties: false`, so a stale root-level `secrets:` block will not be underlined in your editor. The validation error above is the only signal you get.

### 2. Secrets can now be scoped

This is the point of the change. Secrets merge through the same layers as variables — root → group → conditional group → repo, innermost wins:

```yaml
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
  - git: git@github.com:org/web.git
    groups: [frontend]          # SHARED_KEY + NPM_TOKEN

  - git: git@github.com:org/api.git
    settings:
      secrets:
        MY_KEY: false           # opt out of one inherited secret

  - git: git@github.com:org/isolated.git
    settings:
      secrets:
        inherit: false          # discard all inherited secrets
        DEPLOY_KEY:
          env: ISOLATED_DEPLOY_KEY
```

See [Secrets](configuration/secrets.md) for the full reference, including the `inherit: false` + `deleteOrphaned: true` interaction.

### 3. Group-level `variables.inherit: false` no longer clears `deleteOrphaned`

`deleteOrphaned` is a policy switch, not an entry. The repo layer already treated it that way; the group layer did not. Both now behave the same: `inherit: false` discards inherited *entries* only.

**v6 behaviour:** root `variables.deleteOrphaned: true` + a group with `variables: { inherit: false, ... }` silently disabled orphan deletion for that group.

**v7 behaviour:** `deleteOrphaned: true` stays on.

To opt out, set it explicitly:

```yaml
groups:
  myGroup:
    settings:
      variables:
        inherit: false
        deleteOrphaned: false   # was implicit in v6, now required
        MY_VAR: "value"
```

The same rule applies to the new `settings.secrets`.

### 4. Split config folders: only root `settings:` is single-file

In a split config folder, root-level `settings:` — and therefore any root-level secrets — must live in exactly one file. Group- and repo-scoped secrets can be spread across files as usual, because `groups` and `repos` merge across files.

This also fixes a v6 bug: a root-level `secrets:` block in a split config folder was silently dropped during the merge, so `xfg secrets sync` reported no secrets at all. Under `settings:` it merges correctly.

## GitHub Action

Update your workflow files from `@v6` to `@v7`:

**Before (v6):**

```yaml
- uses: anthony-spruyt/xfg@v6
  with:
    config: ./config.yaml
```

**After (v7):**

```yaml
- uses: anthony-spruyt/xfg@v7
  with:
    config: ./config.yaml
```

## No Changes Required

- **`xfg secrets sync`** — still a separate command; a plain `xfg sync` never touches secrets, even though they now live under `settings:`
- **Secret encryption and env-var resolution** — unchanged (libsodium sealed box, values read from environment variables at runtime)
- **Secret naming rules** — unchanged, including case-insensitive matching
- **CLI flags** — `--dry-run`, `--no-delete`, `--config`, `--work-dir`, `--retries` all work the same way
- **Everything else under `settings:`** — rulesets, labels, repo settings, code scanning are unchanged
