# Repository Settings

xfg can manage GitHub repository settings declaratively using the `settings` command. Configure features, merge options, and security settings in your config file, and xfg will update repositories to match your desired state.

!!! note "GitHub-Only Feature"
Repository settings are only available for GitHub repositories. Azure DevOps and GitLab repos will be skipped when running `xfg settings`.

## Quick Start

```yaml
id: my-config

settings:
  repo:
    # Merge options
    allowSquashMerge: true
    allowRebaseMerge: false
    deleteBranchOnMerge: true

    # Security
    vulnerabilityAlerts: true
    automatedSecurityFixes: true

repos:
  - git: git@github.com:your-org/your-repo.git
```

```bash
# Preview changes (dry-run)
xfg settings -c config.yaml --dry-run

# Apply settings
xfg settings -c config.yaml
```

## Available Settings

### Features

| Setting                    | Type    | Description                           |
| -------------------------- | ------- | ------------------------------------- |
| `hasIssues`                | boolean | Enable/disable GitHub Issues          |
| `hasProjects`              | boolean | Enable/disable GitHub Projects        |
| `hasWiki`                  | boolean | Enable/disable the repository wiki    |
| `hasDiscussions`           | boolean | Enable/disable GitHub Discussions     |
| `isTemplate`               | boolean | Mark as a template repository         |
| `allowForking`             | boolean | Allow forking (private repos)         |
| `visibility`               | string  | `public`, `private`, or `internal`    |
| `archived`                 | boolean | Archive the repository                |
| `webCommitSignoffRequired` | boolean | Require sign-off on web-based commits |
| `defaultBranch`            | string  | Set the default branch                |

### Merge Options

| Setting                    | Type    | Description                              |
| -------------------------- | ------- | ---------------------------------------- |
| `allowSquashMerge`         | boolean | Allow squash merging                     |
| `allowMergeCommit`         | boolean | Allow merge commits                      |
| `allowRebaseMerge`         | boolean | Allow rebase merging                     |
| `allowAutoMerge`           | boolean | Allow auto-merge                         |
| `deleteBranchOnMerge`      | boolean | Auto-delete head branches                |
| `allowUpdateBranch`        | boolean | Show "Update branch" button              |
| `squashMergeCommitTitle`   | string  | `PR_TITLE` or `COMMIT_OR_PR_TITLE`       |
| `squashMergeCommitMessage` | string  | `PR_BODY`, `COMMIT_MESSAGES`, or `BLANK` |
| `mergeCommitTitle`         | string  | `PR_TITLE` or `MERGE_MESSAGE`            |
| `mergeCommitMessage`       | string  | `PR_BODY`, `PR_TITLE`, or `BLANK`        |

### Security

| Setting                         | Type    | Description                     |
| ------------------------------- | ------- | ------------------------------- |
| `vulnerabilityAlerts`           | boolean | Dependabot vulnerability alerts |
| `automatedSecurityFixes`        | boolean | Dependabot security updates     |
| `secretScanning`                | boolean | Secret scanning                 |
| `secretScanningPushProtection`  | boolean | Push protection for secrets     |
| `privateVulnerabilityReporting` | boolean | Private vulnerability reporting |

## Inheritance

Repository settings follow the same inheritance pattern as other xfg configurations. Global settings in the root `settings.repo` are inherited by all repos, and per-repo overrides take precedence.

```yaml
settings:
  repo:
    # Global defaults
    allowSquashMerge: true
    allowRebaseMerge: false
    deleteBranchOnMerge: true
    vulnerabilityAlerts: true

repos:
  - git: git@github.com:your-org/repo-a.git
    # Inherits all global settings

  - git: git@github.com:your-org/repo-b.git
    settings:
      repo:
        # Override: also enable rebase merge
        allowRebaseMerge: true

  - git: git@github.com:your-org/legacy-repo.git
    settings:
      repo:
        # Override: keep merge commits for legacy compatibility
        allowMergeCommit: true
```

## Opting Out of Repo Settings

If you define repo settings at the root level but want specific repos to skip them entirely, set `repo: false` at the per-repo level:

```yaml
settings:
  repo:
    allowSquashMerge: true
    deleteBranchOnMerge: true
    vulnerabilityAlerts: true

  rulesets:
    main-protection:
      target: branch
      enforcement: active

repos:
  # Inherits all repo settings + rulesets
  - git: git@github.com:your-org/standard-repo.git

  # Opts out of repo settings, still inherits rulesets
  - git: git@github.com:your-org/special-repo.git
    settings:
      repo: false

  # Opts out of repo settings and overrides rulesets
  - git: git@github.com:your-org/custom-repo.git
    settings:
      repo: false
      rulesets:
        main-protection:
          enforcement: evaluate
```

!!! note
`repo: false` is only valid at the per-repo level when root-level repo settings are defined. It cannot be used at the root level.

## Warnings

xfg displays warnings for potentially destructive operations:

| Operation                                     | Warning                                                         |
| --------------------------------------------- | --------------------------------------------------------------- |
| Change `visibility`                           | "visibility change may expose or hide repository"               |
| Set `archived: true`                          | "archiving makes repository read-only"                          |
| Disable `hasIssues`, `hasWiki`, `hasProjects` | "may hide existing content"                                     |
| Change `defaultBranch`                        | "may affect existing PRs, CI workflows, and branch protections" |

Example output:

```text
  your-org/your-repo:
  Repo Settings:
    ~ visibility: "private" → "public"
  Warning: visibility change (private → public) may expose or hide repository
```

## Dry Run Mode

Use `--dry-run` to preview changes without applying them:

```bash
xfg settings -c config.yaml --dry-run
```

Output shows planned changes in Terraform-style format:

```text
Processing repo settings for 2 repositories

  your-org/repo-a:
  Repo Settings:
    + allowAutoMerge: true
    ~ deleteBranchOnMerge: false → true

  your-org/repo-b:
  Repo Settings:
    + vulnerabilityAlerts: true
    + automatedSecurityFixes: true
```

## Combining with Rulesets

Repository settings can be configured alongside GitHub Rulesets:

```yaml
settings:
  # Repository settings
  repo:
    allowSquashMerge: true
    deleteBranchOnMerge: true
    vulnerabilityAlerts: true

  # GitHub Rulesets
  rulesets:
    main-protection:
      target: branch
      enforcement: active
      conditions:
        refName:
          include:
            - refs/heads/main
      rules:
        - type: pull_request
          parameters:
            requiredApprovingReviewCount: 1
```

Run `xfg settings` to apply both:

```bash
xfg settings -c config.yaml
```

## API Limitations

Some settings require separate API calls and may have limitations:

- **Vulnerability alerts** and **automated security fixes** use separate endpoints
- **Secret scanning** settings are part of `security_and_analysis` (requires GitHub Advanced Security on some plans)
- **Visibility changes** may require organization admin permissions

## See Also

- [GitHub Rulesets](rulesets.md) - Branch protection via rulesets
- [Inheritance](inheritance.md) - How settings are merged
- [CLI Options](../reference/cli-options.md) - Command line reference
