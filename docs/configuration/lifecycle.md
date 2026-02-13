# Repo Lifecycle Management

xfg can automatically create, fork, or migrate repositories before syncing files or applying settings. This is useful when managing repos declaratively - if a target repo doesn't exist yet, xfg will create it for you.

## How It Works

Before processing each repo, xfg checks if the target repository exists:

1. **Exists** - Proceed normally with sync/settings
2. **Missing** - Create an empty repo
3. **Missing + `upstream`** - Fork from the upstream repo
4. **Missing + `source`** - Clone source with `--mirror` and push to new target

## Fields

| Field      | Type   | Description                                                      |
| ---------- | ------ | ---------------------------------------------------------------- |
| `upstream` | string | Git URL of repo to fork from (GitHub only)                       |
| `source`   | string | Git URL of repo to migrate from (e.g., Azure DevOps to GitHub)   |

<!-- markdownlint-disable MD046 -->
!!! warning "Mutually exclusive"
    `upstream` and `source` cannot be used together on the same repo.
    Use `upstream` for forking within GitHub, or `source` for cross-platform migration.
<!-- markdownlint-enable MD046 -->

<!-- markdownlint-disable MD046 -->
!!! note "Forking is GitHub-only"
    Both the `upstream` and target repos must be on GitHub (or GitHub Enterprise).
    Cross-platform forking is not supported. For cross-platform transfers, use `source` (migration) instead.
<!-- markdownlint-enable MD046 -->

## Forking (`upstream`)

Fork an existing repo into your organization or personal account:

```yaml
repos:
  # Fork into an organization
  - git: git@github.com:my-org/forked-tool.git
    upstream: git@github.com:opensource/cool-tool.git

  # Fork into a personal account
  - git: git@github.com:myusername/my-fork.git
    upstream: git@github.com:opensource/cool-tool.git
```

When the target repo doesn't exist, xfg will:

1. Detect whether the target owner is an organization or user
2. Fork the upstream repo accordingly
3. Continue with normal sync/settings

If the repo already exists, the `upstream` field is ignored.

<!-- markdownlint-disable MD046 -->
!!! note "Git array expansion"
    When using a `git` array with `upstream`, the same upstream is applied to all expanded repos:

    ```yaml
    repos:
      - git:
          - git@github.com:my-org/fork-a.git
          - git@github.com:my-org/fork-b.git
        upstream: git@github.com:opensource/tool.git
    ```

    This creates two forks of `opensource/tool` with different names (`fork-a` and `fork-b`).
<!-- markdownlint-enable MD046 -->

<!-- markdownlint-disable MD046 -->
!!! note "Fork settings"
    After forking, xfg will apply `settings.repo.visibility` and `settings.repo.description`
    if configured. This allows you to fork a public repo and make it private, or vice versa.
<!-- markdownlint-enable MD046 -->

## Migration (`source`)

Migrate a repo from another platform (e.g., Azure DevOps to GitHub):

```yaml
repos:
  - git: git@github.com:my-org/migrated-app.git
    source: https://dev.azure.com/myorg/myproject/_git/legacy-app
```

When `my-org/migrated-app` doesn't exist, xfg will:

1. Clone `legacy-app` from Azure DevOps with `--mirror` (all branches and tags)
2. Create `migrated-app` on GitHub
3. Push the mirrored content to the new repo
4. Clean up the temporary clone
5. Continue with normal sync/settings

If the repo already exists, the `source` field is ignored.

## Creation Settings

When creating a new repo (via create, fork, or migrate), xfg applies settings from `settings.repo` if configured.
Repos are created as **private** by default. Set `visibility: public` explicitly if needed.

```yaml
settings:
  repo:
    description: "My new repository"
    visibility: private
    hasIssues: true
    hasWiki: false

repos:
  - git: git@github.com:my-org/new-repo.git
    # No upstream or source = create empty repo with above settings
```

The following settings apply during repo creation:

| Setting       | Description                                      |
| ------------- | ------------------------------------------------ |
| `description` | Repository description                           |
| `visibility`  | `public`, `private`, or `internal`               |
| `hasIssues`   | Enable/disable Issues (default: enabled)         |
| `hasWiki`     | Enable/disable Wiki (default: enabled)           |

### Empty Repository Initialization

When creating a new repository, xfg uses `--add-readme` to establish the default branch with an initial commit, then immediately deletes the README to leave the repo in a clean state. This ensures subsequent clone and push operations work correctly, since empty repositories without any commits have no resolvable `HEAD`.

### Mirror Clone Cleanup

When migrating with `source`, the mirror clone may include platform-specific refs that GitHub rejects on push (such as `refs/pull/*` from GitHub, `refs/merge-requests/*` from GitLab, or other internal refs). xfg automatically strips all refs except branches (`refs/heads/*`) and tags (`refs/tags/*`) before pushing to the target repository.

## Dry Run

In dry-run mode (`--dry-run`), lifecycle operations are reported but not executed:

```text
+ CREATE my-org/new-repo
+ FORK github.com/opensource/tool -> my-org/forked-tool
+ MIGRATE dev.azure.com/myorg/legacy/old-api -> my-org/migrated-app
```

## Supported Platforms

| Operation         | GitHub | Azure DevOps | GitLab |
| ----------------- | ------ | ------------ | ------ |
| Create (target)   | Yes    | -            | -      |
| Fork (target)     | Yes    | -            | -      |
| Migrate (target)  | Yes    | -            | -      |
| Migrate (source)  | -      | Yes          | -      |

## Example: Full Lifecycle Config

```yaml
id: my-org-repos

settings:
  repo:
    visibility: private
    hasWiki: false
    deleteBranchOnMerge: true

files:
  .gitignore:
    content: |
      node_modules/
      dist/

repos:
  # Existing repo - just sync files
  - git: git@github.com:my-org/existing-service.git

  # Fork an open-source tool
  - git: git@github.com:my-org/our-eslint-config.git
    upstream: git@github.com:airbnb/javascript.git

  # Migrate from Azure DevOps
  - git: git@github.com:my-org/migrated-api.git
    source: https://dev.azure.com/myorg/legacy/_git/old-api
```
