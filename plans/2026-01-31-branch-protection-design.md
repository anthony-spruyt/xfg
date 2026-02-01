# Rulesets & Repo-as-Code Design

**Issue:** [#140](https://github.com/anthony-spruyt/xfg/issues/140)
**Date:** 2026-01-31
**Status:** Approved (Updated: Pivoted from branch protection to rulesets)

## Overview

Extend xfg from a file sync tool into a full repo-as-code solution. This design covers GitHub Rulesets (Phase 1) and establishes the architecture for repo creation, fork management, and comprehensive settings management (future phases).

**Why Rulesets over Branch Protection?**

- More flexible (pattern-based conditions, multiple rules per ruleset)
- More features (code_scanning, code_quality, workflows, file restrictions)
- Bypass actors with fine-grained control (always vs pull_request only)
- Modern API that GitHub is actively developing
- Matches existing `.github/rulesets/*.json` patterns in use

## Use Cases

1. **Consistent security baseline** - Ensure all repos have minimum protection (e.g., require reviews on main)
2. **Compliance enforcement** - Auditable, version-controlled branch policies for regulated environments
3. **Onboarding automation** - New repos automatically get standard protection rules
4. **Fork management** (future) - Fork repos and configure them with preferred settings

## Design Decisions

### Subcommands

Introduce subcommands to separate concerns:

| Command       | Purpose                                         |
| ------------- | ----------------------------------------------- |
| `xfg sync`    | File sync (current behavior)                    |
| `xfg protect` | Ruleset management                              |
| `xfg` (bare)  | Alias to `xfg sync` for backwards compatibility |

**Rationale:** Clean separation enables independent operation (e.g., apply rulesets to existing repos without file changes), different permissions (sync needs write, protect needs admin), and future extensibility.

### Config Schema

Root-level `settings.rulesets` mirrors the existing `files` pattern - define defaults at root, override per-repo:

```yaml
id: my-config

prOptions:
  merge: auto
deleteOrphaned: true

# Root-level settings = defaults for all repos
settings:
  rulesets:
    pr-rules:
      target: branch
      enforcement: active
      bypassActors:
        - actorId: 2719952
          actorType: Integration
          bypassMode: always
      conditions:
        refName:
          include: ["refs/heads/main"]
      rules:
        - type: pull_request
          parameters:
            requiredApprovingReviewCount: 1
            dismissStaleReviewsOnPush: true
        - type: required_status_checks
          parameters:
            strictRequiredStatusChecksPolicy: true
            requiredStatusChecks:
              - context: "ci/build"

files:
  .github/dependabot.yml:
    content: { ... }

repos:
  # Gets all defaults
  - git: "org/standard-repo"

  # Overrides specific settings (deep merged with root)
  - git: "org/critical-repo"
    settings:
      rulesets:
        pr-rules:
          rules:
            - type: pull_request
              parameters:
                requiredApprovingReviewCount: 3 # override
```

**Key points:**

- `settings.rulesets` at root = defaults for all repos
- `settings.rulesets` per-repo = deep merged with root defaults
- Ruleset names as keys (e.g., `pr-rules`, `release-rules`)
- No breaking changes to existing configs

### Rulesets Schema

GitHub Rulesets API-aligned with camelCase field names:

```yaml
settings:
  rulesets:
    pr-rules:
      # Ruleset metadata
      target: branch # or "tag"
      enforcement: active # or "disabled", "evaluate"

      # Bypass actors - who can skip these rules
      bypassActors:
        - actorId: 2719952
          actorType: Integration # or "Team", "User"
          bypassMode: always # or "pull_request"

      # Conditions - which refs this applies to
      conditions:
        refName:
          include: ["refs/heads/main", "refs/heads/release/*"]
          exclude: ["refs/heads/dev*"]

      # Rules - array of rule objects
      rules:
        # Pull request requirements
        - type: pull_request
          parameters:
            requiredApprovingReviewCount: 2
            dismissStaleReviewsOnPush: true
            requireCodeOwnerReview: true
            requireLastPushApproval: true
            requiredReviewThreadResolution: true
            allowedMergeMethods: [squash]

        # Status checks
        - type: required_status_checks
          parameters:
            strictRequiredStatusChecksPolicy: true
            doNotEnforceOnCreate: false
            requiredStatusChecks:
              - context: "ci/build"
              - context: "ci/test"
                integrationId: 12345

        # Simple rules (no parameters)
        - type: required_signatures
        - type: required_linear_history
        - type: non_fast_forward
        - type: creation
        - type: deletion

        # Code scanning
        - type: code_scanning
          parameters:
            codeScanningTools:
              - tool: CodeQL
                alertsThreshold: errors
                securityAlertsThreshold: high_or_higher

        # Pattern rules
        - type: commit_message_pattern
          parameters:
            operator: regex
            pattern: "^(feat|fix|docs|chore):"
            negate: false
```

**Key points:**

- Ruleset names as keys
- camelCase field names (JS convention, maps to GitHub's snake_case API)
- Rules as typed array with discriminated union on `type`
- All fields optional except required ones per rule type

### Rule Types Reference

| Rule Type                     | Parameters                                                                                                                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pull_request`                | `requiredApprovingReviewCount`, `dismissStaleReviewsOnPush`, `requireCodeOwnerReview`, `requireLastPushApproval`, `requiredReviewThreadResolution`, `allowedMergeMethods`, `requiredReviewers` |
| `required_status_checks`      | `strictRequiredStatusChecksPolicy`, `doNotEnforceOnCreate`, `requiredStatusChecks[]`                                                                                                           |
| `required_signatures`         | (none)                                                                                                                                                                                         |
| `required_linear_history`     | (none)                                                                                                                                                                                         |
| `non_fast_forward`            | (none)                                                                                                                                                                                         |
| `creation`                    | (none)                                                                                                                                                                                         |
| `update`                      | `updateAllowsFetchAndMerge`                                                                                                                                                                    |
| `deletion`                    | (none)                                                                                                                                                                                         |
| `required_deployments`        | `requiredDeploymentEnvironments[]`                                                                                                                                                             |
| `code_scanning`               | `codeScanningTools[]` with `tool`, `alertsThreshold`, `securityAlertsThreshold`                                                                                                                |
| `code_quality`                | `severity`                                                                                                                                                                                     |
| `workflows`                   | `doNotEnforceOnCreate`, `workflows[]` with `path`, `repositoryId`, `ref`, `sha`                                                                                                                |
| `commit_author_email_pattern` | `operator`, `pattern`, `name`, `negate`                                                                                                                                                        |
| `commit_message_pattern`      | `operator`, `pattern`, `name`, `negate`                                                                                                                                                        |
| `committer_email_pattern`     | `operator`, `pattern`, `name`, `negate`                                                                                                                                                        |
| `branch_name_pattern`         | `operator`, `pattern`, `name`, `negate`                                                                                                                                                        |
| `tag_name_pattern`            | `operator`, `pattern`, `name`, `negate`                                                                                                                                                        |
| `file_path_restriction`       | `restrictedFilePaths[]`                                                                                                                                                                        |
| `file_extension_restriction`  | `restrictedFileExtensions[]`                                                                                                                                                                   |
| `max_file_path_length`        | `maxFilePathLength`                                                                                                                                                                            |
| `max_file_size`               | `maxFileSize`                                                                                                                                                                                  |

### Orphan Handling

`deleteOrphaned` applies at the ruleset level:

- **Ruleset in config** - Create or update
- **Ruleset removed from config + `deleteOrphaned: true`** - Delete entire ruleset
- **Ruleset removed from config + `deleteOrphaned: false`** - Leave as-is (orphaned)

### Manifest V3

Current V2 manifest is a flat array per config. V3 adds resource types:

```json
{
  "version": 3,
  "configs": {
    "my-config": {
      "files": [".github/dependabot.yml", "renovate.json"],
      "rulesets": ["pr-rules", "release-rules"]
    }
  }
}
```

**Benefits:**

- Track each resource type independently
- Clear what xfg manages vs what it doesn't
- Extensible for future resource types
- `deleteOrphaned` can be scoped per resource type

**Migration:** V2 `string[]` automatically becomes `{ files: string[] }`.

### Authentication

Support both GitHub PAT and GitHub App:

- **PAT:** Use directly via `gh api`
- **App:** Use token from `GitHubAppTokenManager`, pass via `GH_TOKEN` env var

Same pattern as existing `graphql-commit-strategy.ts`.

### Dry-Run Output

Show diff of ruleset changes:

```text
org/my-repo:
  pr-rules:
    rules[0] (pull_request):
      + requiredApprovingReviewCount: 1 → 2
      = dismissStaleReviewsOnPush: true (unchanged)
    rules[1] (required_status_checks):
      + NEW rule

org/other-repo:
  pr-rules: (no changes)
  release-rules:
    + NEW ruleset
```

### Error Handling

Continue on failure (consistent with file sync):

- Process all repos
- Report failures at end
- Exit code reflects any failures

## Architecture

### New Modules

| Module                                  | Purpose                                        |
| --------------------------------------- | ---------------------------------------------- |
| `ruleset-processor.ts`                  | Orchestrates rulesets for all repos            |
| `strategies/github-ruleset-strategy.ts` | GitHub API calls for rulesets                  |
| `ruleset-diff.ts`                       | Compare config vs current state, generate diff |

### Flow for `xfg protect`

```text
1. Load config
2. For each repo:
   a. Resolve settings (deep merge root + repo-level rulesets)
   b. Fetch current rulesets from GitHub API
   c. Diff config vs current state
   d. If dry-run: display diff
   e. If not dry-run: create/update rulesets via API
   f. If deleteOrphaned: remove rulesets not in config
3. Report results (same format as sync)
```

### GitHub API

```bash
# List rulesets
gh api /repos/{owner}/{repo}/rulesets

# Get ruleset by ID
gh api /repos/{owner}/{repo}/rulesets/{ruleset_id}

# Create ruleset
gh api -X POST /repos/{owner}/{repo}/rulesets --input ruleset.json

# Update ruleset
gh api -X PUT /repos/{owner}/{repo}/rulesets/{ruleset_id} --input ruleset.json

# Delete ruleset
gh api -X DELETE /repos/{owner}/{repo}/rulesets/{ruleset_id}
```

### Files to Create/Modify

| File                                        | Action                        |
| ------------------------------------------- | ----------------------------- |
| `src/index.ts`                              | Add subcommand structure      |
| `src/config.ts`                             | Add `settings.rulesets` types |
| `src/config-validator.ts`                   | Validate ruleset structure    |
| `src/config-normalizer.ts`                  | Merge settings defaults       |
| `src/manifest.ts`                           | V3 schema with resource types |
| `src/ruleset-processor.ts`                  | NEW                           |
| `src/strategies/github-ruleset-strategy.ts` | NEW                           |
| `src/ruleset-diff.ts`                       | NEW                           |
| `config-schema.json`                        | Add settings schema           |

## Phase 1 Scope (This Implementation)

**In scope:**

- `xfg protect` subcommand (GitHub only)
- `settings.rulesets` in config (root + per-repo)
- Deep merge with root-level defaults
- Manifest V3 for tracking managed rulesets
- `deleteOrphaned` support for removing unmanaged rulesets
- Dry-run with diff output
- GitHub PAT and App authentication support

**Out of scope:**

- `xfg sync` refactor to explicit subcommand (bare `xfg` stays as sync)
- Repo creation
- Fork management
- Other settings (`features`, `mergeOptions`, `security`)
- Azure DevOps / GitLab support
- Organization-level rulesets (only repo-level)

## Future Phases

### Phase 2: Declarative Repo Management

Repo creation and fork management through declarative config.

### Phase 3: Comprehensive Settings

Add support for all repo settings (features, merge options, security).

### Phase 4: Multi-Platform Support

Extend protection strategies for Azure DevOps and GitLab.

### Phase 5: Organization Rulesets

Support organization-level rulesets that apply across multiple repos.

## CLI Reference

### `xfg protect`

```bash
# Apply rulesets from config
xfg protect -c config.yaml

# Dry-run - show what would change
xfg protect -c config.yaml --dry-run

# Skip orphan deletion
xfg protect -c config.yaml --no-delete
```

### Shared Flags

| Flag                     | Description                      |
| ------------------------ | -------------------------------- |
| `-c, --config <path>`    | Config file (required)           |
| `-d, --dry-run`          | Preview changes without applying |
| `-w, --work-dir <path>`  | Temp directory                   |
| `-r, --retries <number>` | Network retry count              |
| `--no-delete`            | Skip orphan deletion             |
