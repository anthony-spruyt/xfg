# GitHub Rulesets

xfg can manage GitHub Rulesets declaratively using the `settings` command. Define rulesets in your config file, and xfg will create, update, or delete them to match your desired state.

!!! note "GitHub-Only Feature"
    Rulesets are only available for GitHub repositories. Azure DevOps and GitLab repos will be skipped when running `xfg settings`.

## Quick Start

```yaml
id: my-config

files:
  .prettierrc.json:
    content:
      semi: false

settings:
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

repos:
  - git: git@github.com:your-org/your-repo.git
```

```bash
# Sync files
xfg sync -c config.yaml

# Apply rulesets
xfg settings -c config.yaml
```

## Why Rulesets?

GitHub Rulesets offer advantages over legacy branch protection rules:

- **Pattern-based conditions** - Apply rules to multiple branches with glob patterns
- **Multiple rules per ruleset** - Group related rules together
- **Bypass actors** - Fine-grained control over who can bypass rules
- **Evaluate mode** - Test rules without enforcing them
- **Advanced rules** - Code scanning, workflows, file restrictions

## Ruleset Structure

```yaml
settings:
  rulesets:
    ruleset-name: # Unique name for this ruleset
      target: branch # "branch" or "tag"
      enforcement: active # "active", "disabled", or "evaluate"

      bypassActors: # Optional: who can bypass these rules
        - actorId: 12345
          actorType: Team # "Team", "User", or "Integration"
          bypassMode: always # "always" or "pull_request"

      conditions: # Which refs this applies to
        refName:
          include:
            - refs/heads/main
            - refs/heads/release/*
          exclude:
            - refs/heads/dev*

      rules: # Array of rule objects
        - type: pull_request
          parameters:
            requiredApprovingReviewCount: 2
```

## Available Rule Types

### Pull Request Rules

```yaml
- type: pull_request
  parameters:
    requiredApprovingReviewCount: 2 # 0-10
    dismissStaleReviewsOnPush: true
    requireCodeOwnerReview: true
    requireLastPushApproval: true
    requiredReviewThreadResolution: true
    allowedMergeMethods:
      - squash
      - rebase
    requiredReviewers: # (beta) file-pattern-based reviewers
      - filePatterns: ["src/auth/**"]
        minimumApprovals: 2
        reviewer:
          id: 123456
          type: Team
```

### Status Checks

```yaml
- type: required_status_checks
  parameters:
    strictRequiredStatusChecksPolicy: true
    doNotEnforceOnCreate: false
    requiredStatusChecks:
      - context: "ci/build"
      - context: "ci/test"
        integrationId: 12345
```

### Simple Rules (No Parameters)

```yaml
- type: required_signatures
- type: required_linear_history
- type: non_fast_forward
- type: creation
- type: deletion
```

### Update Rule

```yaml
- type: update
  parameters:
    updateAllowsFetchAndMerge: true
```

### Deployments

```yaml
- type: required_deployments
  parameters:
    requiredDeploymentEnvironments:
      - production
      - staging
```

### Code Scanning

```yaml
- type: code_scanning
  parameters:
    codeScanningTools:
      - tool: CodeQL
        alertsThreshold: errors # none, errors, errors_and_warnings, all
        securityAlertsThreshold: critical # none, critical, high_or_higher, medium_or_higher, all
```

### Code Quality

```yaml
- type: code_quality
  parameters:
    severity: errors # errors, errors_and_warnings, all
```

### Workflows

Require specific GitHub Actions workflows to pass:

```yaml
- type: workflows
  parameters:
    doNotEnforceOnCreate: false
    workflows:
      - path: .github/workflows/ci.yml
        repositoryId: 123456789
        ref: refs/heads/main
```

### Pattern Rules

All pattern rules support the same parameters:

| Parameter  | Type    | Description                                                |
| ---------- | ------- | ---------------------------------------------------------- |
| `name`     | string  | Display name for the rule (optional)                       |
| `operator` | string  | `starts_with`, `ends_with`, `contains`, or `regex`         |
| `pattern`  | string  | The pattern to match                                       |
| `negate`   | boolean | If true, the rule applies when the pattern does NOT match  |

```yaml
- type: commit_message_pattern
  parameters:
    name: "Conventional commits"
    operator: regex
    pattern: "^(feat|fix|docs|style|refactor|test|chore)(\\(.+\\))?: .+"
    negate: false

- type: commit_author_email_pattern
  parameters:
    name: "Corporate email only"
    operator: ends_with
    pattern: "@your-company.com"

- type: committer_email_pattern
  parameters:
    operator: ends_with
    pattern: "@your-company.com"

- type: branch_name_pattern
  parameters:
    operator: regex
    pattern: "^(feature|bugfix|hotfix)/.+"

- type: tag_name_pattern
  parameters:
    name: "Semantic versioning"
    operator: regex
    pattern: "^v[0-9]+\\.[0-9]+\\.[0-9]+"
```

### File Restrictions

```yaml
- type: file_path_restriction
  parameters:
    restrictedFilePaths:
      - ".github/workflows/*"
      - "package-lock.json"

- type: file_extension_restriction
  parameters:
    restrictedFileExtensions:
      - ".exe"
      - ".dll"
      - ".jar"

- type: max_file_path_length
  parameters:
    maxFilePathLength: 255

- type: max_file_size
  parameters:
    maxFileSize: 10485760 # 10MB in bytes
```

## Inheritance and Opt-Out

Like files, rulesets support inheritance with options to opt out.

### Default Inheritance

Define defaults at the root level and override per-repo:

```yaml
# Root-level defaults for all repos
settings:
  rulesets:
    main-protection:
      target: branch
      enforcement: active
      conditions:
        refName:
          include: [refs/heads/main]
      rules:
        - type: pull_request
          parameters:
            requiredApprovingReviewCount: 1

repos:
  # Gets default ruleset
  - git: git@github.com:your-org/standard-repo.git

  # Overrides with stricter requirements
  - git: git@github.com:your-org/critical-repo.git
    settings:
      rulesets:
        main-protection:
          rules:
            - type: pull_request
              parameters:
                requiredApprovingReviewCount: 3 # Override
```

### Single Ruleset Opt-Out

Set a ruleset to `false` to exclude it from a specific repo:

```yaml
settings:
  rulesets:
    main-protection:
      target: branch
      enforcement: active
    release-protection:
      target: branch
      enforcement: active

repos:
  # Gets both rulesets
  - git: git@github.com:your-org/standard-repo.git

  # Skips release-protection only
  - git: git@github.com:your-org/no-releases.git
    settings:
      rulesets:
        release-protection: false
```

### Skipping All Inherited Rulesets

Use `inherit: false` to skip all root-level rulesets. You can optionally add repo-specific rulesets:

```yaml
settings:
  rulesets:
    main-protection:
      target: branch
      enforcement: active

repos:
  # No rulesets at all
  - git: git@github.com:your-org/experimental.git
    settings:
      rulesets:
        inherit: false

  # Skip inherited, add custom
  - git: git@github.com:your-org/custom-rules.git
    settings:
      rulesets:
        inherit: false
        custom-ruleset:
          target: tag
          enforcement: active
          conditions:
            refName:
              include: [refs/tags/v*]
          rules:
            - type: required_signatures
```

## Bypass Actors

Allow specific users, teams, or integrations to bypass rules:

```yaml
bypassActors:
  # GitHub App (e.g., Renovate, Dependabot)
  - actorId: 2719952
    actorType: Integration
    bypassMode: always

  # Team
  - actorId: 123456
    actorType: Team
    bypassMode: pull_request # Only bypass via PRs

  # User
  - actorId: 789012
    actorType: User
    bypassMode: always
```

!!! tip "Finding Actor IDs"
    Use the GitHub API to find actor IDs.

```bash
# Team ID
gh api orgs/{org}/teams/{team-slug} --jq '.id'

# User ID
gh api users/{username} --jq '.id'

# Integration ID (GitHub Apps)
gh api orgs/{org}/installations --jq '.installations[] | {name: .app_slug, id: .app_id}'
```

## Orphan Deletion

When `deleteOrphaned: true` is set, xfg tracks which rulesets it manages and deletes any that are removed from the config:

```yaml
id: my-config
deleteOrphaned: true

settings:
  rulesets:
    main-protection: # This ruleset is tracked
      # ...
```

If you later remove `main-protection` from the config and run `xfg settings`, it will be deleted from the repository.

Use `--no-delete` to skip orphan deletion:

```bash
xfg settings -c config.yaml --no-delete
```

## Dry Run

Preview changes without applying them:

```bash
xfg settings -c config.yaml --dry-run
```

Output shows planned changes:

```text
Loading config from: ./config.yaml
Running in DRY RUN mode - no changes will be made

Found 2 repositories with rulesets

[1/2] your-org/repo1: Processing rulesets...
[1/2] ✓ your-org/repo1: [DRY RUN] 1 created, 0 updated, 0 deleted

[2/2] your-org/repo2: Processing rulesets...
[2/2] ✓ your-org/repo2: [DRY RUN] 0 created, 1 updated, 0 deleted
```

## Combining with File Sync

The `sync` and `settings` commands are independent. Run them together or separately:

```bash
# Sync files and apply rulesets
xfg sync -c config.yaml && xfg settings -c config.yaml

# Or run separately
xfg sync -c config.yaml
xfg settings -c config.yaml --dry-run  # Preview first
xfg settings -c config.yaml            # Apply
```

## Complete Example

```yaml
id: org-standards
deleteOrphaned: true

prOptions:
  merge: auto
  mergeStrategy: squash

settings:
  rulesets:
    main-protection:
      target: branch
      enforcement: active
      bypassActors:
        - actorId: 2719952
          actorType: Integration
          bypassMode: always
      conditions:
        refName:
          include:
            - refs/heads/main
      rules:
        - type: pull_request
          parameters:
            requiredApprovingReviewCount: 1
            dismissStaleReviewsOnPush: true
            requireCodeOwnerReview: true
        - type: required_status_checks
          parameters:
            strictRequiredStatusChecksPolicy: true
            requiredStatusChecks:
              - context: "ci/build"
              - context: "ci/test"
        - type: required_linear_history

    release-protection:
      target: branch
      enforcement: active
      conditions:
        refName:
          include:
            - refs/heads/release/*
      rules:
        - type: pull_request
          parameters:
            requiredApprovingReviewCount: 2
        - type: required_signatures

files:
  .github/dependabot.yml:
    content:
      version: 2
      updates:
        - package-ecosystem: npm
          directory: /
          schedule:
            interval: weekly

repos:
  - git:
      - git@github.com:your-org/frontend.git
      - git@github.com:your-org/backend.git
      - git@github.com:your-org/shared-lib.git
```
