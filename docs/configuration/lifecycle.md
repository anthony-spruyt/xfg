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

## Forking (`upstream`)

Fork an existing repo into your organization:

```yaml
repos:
  - git: git@github.com:my-org/forked-tool.git
    upstream: git@github.com:opensource/cool-tool.git
```

When `my-org/forked-tool` doesn't exist, xfg will:

1. Fork `opensource/cool-tool` into `my-org` as `forked-tool`
2. Continue with normal sync/settings

If the repo already exists, the `upstream` field is ignored.

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
    visibility: private
    hasIssues: true
    hasWiki: false

repos:
  - git: git@github.com:my-org/new-repo.git
    # No upstream or source = create empty repo with above settings
```

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
