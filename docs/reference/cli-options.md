# CLI Options Reference

xfg uses a `sync` command to handle file synchronization, repository settings, rulesets, labels, code scanning, variables, collaborators, and environments. A separate `secrets sync` command handles secret management.

## Sync Command

Sync configuration files, repository settings, rulesets, labels, code scanning, variables, collaborators, and environments across repositories.

```bash
xfg sync --config <path> [options]
```

### Options

<!-- xfg:generated cli:sync -->

| Option             | Alias | Description                                                                                                                                             | Default      |
| ------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `--config`         | `-c`  | Path to YAML config file                                                                                                                                | **Required** |
| `--branch`         | `-b`  | Override the branch name (default: chore/sync-{filename} or chore/sync-config)                                                                          | -            |
| `--merge`          | `-m`  | PR merge mode: manual, auto (default, merge when checks pass), force (bypass requirements), direct (push to default branch, no PR)                      | -            |
| `--merge-strategy` |       | Merge strategy: merge, squash (default), rebase                                                                                                         | -            |
| `--delete-branch`  |       | Delete source branch after merge                                                                                                                        | `false`      |
| `--no-ai`          |       | Disable AI-generated commit messages and PR descriptions even if prOptions.ai is configured                                                             | `false`      |
| `--render-dir`     |       | With --dry-run, write each repo's planned file changes to \<path>/\<repo>/ and list them in \<path>/render.json. The directory must be empty or missing | -            |
| `--dry-run`        | `-d`  | Show what would be done without making changes                                                                                                          | `false`      |
| `--work-dir`       | `-w`  | Temporary directory for cloning                                                                                                                         | `./tmp`      |
| `--retries`        | `-r`  | Number of retries for network operations (0 to disable)                                                                                                 | `3`          |
| `--no-delete`      |       | Skip deletion of orphaned resources even if deleteOrphaned is configured                                                                                | `false`      |

<!-- xfg:generated:end -->

!!! note "GitHub-Only Settings"
    Repository settings, rulesets, labels, code scanning, variables, collaborators, and environments management only works with GitHub repositories. Azure DevOps and GitLab repos are skipped for settings.

### Examples

```bash
# Basic sync (files + settings)
xfg sync --config ./config.yaml

# Dry run
xfg sync --config ./config.yaml --dry-run

# Custom branch
xfg sync --config ./config.yaml --branch feature/update-eslint

# Override merge behavior
xfg sync --config ./config.yaml --merge manual   # Leave PRs open
xfg sync --config ./config.yaml --merge force    # Force merge
xfg sync --config ./config.yaml --merge direct   # Push directly

# Skip orphan deletion
xfg sync --config ./config.yaml --no-delete
```

### Output

```text
Loading config from: /work/config.yaml
Found 2 repositories to process
Target files: .prettierrc.json
Branch: chore/sync-prettierrc

[1/2] your-org/frontend: Processing...
    Default branch: main (detected via remote HEAD)
    Writing .prettierrc.json...
    Staging changes...
    Committed: 5e2b9d0c7a41f8e3b6d1a09c4f7e2b85d3a6c190 (verified: false)
    Creating pull request...
    Handling merge (mode: auto)...
    Auto-merge enabled. PR will merge when checks pass.
[1/2] ✓ your-org/frontend: PR created successfully

    your-org/frontend - Repo Settings:
        ~ allowAutoMerge: false → true
        ~ deleteBranchOnMerge: false → true
[2/2] your-org/shared: Processing...
    Default branch: main (detected via remote HEAD)
    Writing .prettierrc.json...
[2/2] ⊘ your-org/shared: Skipped - No changes detected
[2/2] ✓ your-org/shared: Repo Settings: No changes needed

~ your-org/frontend
    + .prettierrc.json
    + .xfg.json

Plan: 2 files (2 to create)

~ your-org/frontend
    ! allowAutoMerge: false → true
    ! deleteBranchOnMerge: false → true

Plan: 2 settings (2 to update)
```

## Secrets Sync Command

Sync GitHub Actions secrets to target repositories. Secret values are read from environment variables at runtime and encrypted with libsodium before upload.

```bash
xfg secrets sync --config <path> [options]
```

### Secrets Options

<!-- xfg:generated cli:secrets-sync -->

| Option        | Alias | Description                                             | Default      |
| ------------- | ----- | ------------------------------------------------------- | ------------ |
| `--config`    | `-c`  | Path to xfg config file                                 | **Required** |
| `--dry-run`   | `-d`  | Show what would be done without making changes          | `false`      |
| `--no-delete` |       | Skip deletion of orphaned secrets                       | `false`      |
| `--work-dir`  | `-w`  | Temporary directory for cloning                         | `./tmp`      |
| `--retries`   | `-r`  | Number of retries for network operations (0 to disable) | `3`          |

<!-- xfg:generated:end -->

!!! note "GitHub-Only"
    Secrets management only works with GitHub repositories. Non-GitHub repos are skipped.

### Secrets Examples

```bash
# Dry run (preview changes)
MY_SECRET=value xfg secrets sync --config ./config.yaml --dry-run

# Apply secrets
MY_SECRET=value xfg secrets sync --config ./config.yaml

# Skip orphan deletion
MY_SECRET=value xfg secrets sync --config ./config.yaml --no-delete
```

### Secrets Output

```text
[1/2] ✓ your-org/frontend: Secrets: [DRY RUN] 2 created
        + secret "MY_API_KEY"
        + secret "DATABASE_URL"
      Plan: 2 secrets (2 to create)
[2/2] ✓ your-org/backend: Secrets: [DRY RUN] 1 updated, 1 deleted
        ~ secret "DEPLOY_TOKEN" (update, value write-only)
        - secret "OLD_TOKEN"
      Plan: 2 secrets (1 to update, 1 to delete)
```

Without `--dry-run` each repo line reads `Secrets: Applied: ...` and each `Plan:` line becomes `Applied:` in the past tense, for example `Applied: 2 secrets (2 created)`. See [Secrets — Dry Run Output](../configuration/secrets.md#dry-run-output).

## Priority Order

CLI flags override config file settings:

1. CLI flags (highest priority)
2. Per-repo settings (e.g., `prOptions`, `settings.rulesets`)
3. Conditional group settings (applied in array order)
4. Group settings (applied in order, later groups override earlier ones)
5. Global settings
6. Built-in defaults (lowest priority)

## Exit Codes

| Code | Meaning                                 |
| ---- | --------------------------------------- |
| `0`  | Success - all operations completed      |
| `1`  | Failure - one or more operations failed |
