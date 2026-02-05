# GitHub Repository Settings Support

**Date:** 2026-02-05
**Status:** Design approved

## Overview

Add support for managing GitHub repository settings (features, merge options, security) through xfg's `settings` command, complementing the existing rulesets support.

## Scope

- **Platform:** GitHub only (ADO/GitLab out of scope)
- **Settings covered:** Features, merge options, security settings
- **Excluded:** Classic branch protection (rulesets are the modern replacement)

## Config Schema

New `repo` key under `settings`:

```yaml
settings:
  rulesets: { ... }  # existing
  repo:
    # Features
    hasIssues: boolean
    hasProjects: boolean
    hasWiki: boolean
    hasDiscussions: boolean
    isTemplate: boolean
    allowForking: boolean      # private repos in orgs
    visibility: "public" | "private" | "internal"
    archived: boolean

    # Merge options
    allowSquashMerge: boolean
    allowMergeCommit: boolean
    allowRebaseMerge: boolean
    allowAutoMerge: boolean
    deleteBranchOnMerge: boolean
    allowUpdateBranch: boolean
    squashMergeCommitTitle: "PR_TITLE" | "COMMIT_OR_PR_TITLE"
    squashMergeCommitMessage: "PR_BODY" | "COMMIT_MESSAGES" | "BLANK"
    mergeCommitTitle: "PR_TITLE" | "MERGE_MESSAGE"
    mergeCommitMessage: "PR_BODY" | "PR_TITLE" | "BLANK"

    # Security
    vulnerabilityAlerts: boolean
    automatedSecurityFixes: boolean
    secretScanning: boolean
    secretScanningPushProtection: boolean
    privateVulnerabilityReporting: boolean
```

**All properties optional.** Only specified properties are applied. Unspecified properties are left at GitHub's current value.

**Per-repo override:**

```yaml
repos:
  - git: https://github.com/org/repo
    settings:
      repo:
        hasWiki: true # override root
      rulesets:
        inherit: false # existing pattern
```

## Architecture

### New Files

| File                                              | Purpose                                             |
| ------------------------------------------------- | --------------------------------------------------- |
| `src/repo-settings-processor.ts`                  | Orchestrates fetch → diff → apply for repo settings |
| `src/strategies/github-repo-settings-strategy.ts` | GitHub API calls for repo settings                  |
| `src/repo-settings-diff.ts`                       | Compare current vs desired, generate change set     |
| `src/repo-settings-plan-formatter.ts`             | Terraform-style output for repo settings changes    |

### Interfaces

```typescript
interface IRepoSettingsStrategy {
  getSettings(repo: RepoInfo): Promise<CurrentRepoSettings>;
  updateSettings(repo: RepoInfo, settings: RepoSettings): Promise<void>;
  enableVulnerabilityAlerts(repo: RepoInfo, enable: boolean): Promise<void>;
  enableAutomatedSecurityFixes(repo: RepoInfo, enable: boolean): Promise<void>;
}

interface IRepoSettingsProcessor {
  process(
    repo: RepoInfo,
    desired: RepoSettings,
    options: { dryRun: boolean }
  ): Promise<RepoSettingsResult>;
}

interface IRepoSettingsPlanFormatter {
  formatPlan(diff: RepoSettingsDiff, repoName: string): string;
  formatSummary(results: RepoSettingsResult[]): string;
}
```

### Integration Points

1. **`config.ts`** - Add `RepoSettings` type, update `Settings` interface
2. **`config-validator.ts`** - Add `validateRepoSettings()`
3. **`config-normalizer.ts`** - Merge root `settings.repo` with per-repo overrides
4. **`index.ts` / `runSettings()`** - Process repo settings after rulesets
5. **`config-schema.json`** - Add JSON schema for `repo` settings

### No Manifest Changes

Unlike rulesets (named items needing orphan tracking), repo settings are a single object per repo. Nothing to track for deletion.

## API Integration

### GitHub Endpoints

| Setting Type             | Endpoint                                         | Method         |
| ------------------------ | ------------------------------------------------ | -------------- |
| Most settings            | `/repos/{owner}/{repo}`                          | `PATCH`        |
| Vulnerability alerts     | `/repos/{owner}/{repo}/vulnerability-alerts`     | `PUT`/`DELETE` |
| Automated security fixes | `/repos/{owner}/{repo}/automated-security-fixes` | `PUT`/`DELETE` |

### Implementation Notes

- Main settings: Single `PATCH` call with all changed properties
- Security features: Separate endpoints, called individually only when specified
- Secret scanning: Part of `security_and_analysis` object in main PATCH
- Uses `gh api` CLI with `--hostname` for GitHub Enterprise
- camelCase config → snake_case API (same utilities as rulesets)

## Plan Output Format

```
Repository: org/my-repo
  Settings:
    ~ hasWiki: true → false
    ~ allowAutoMerge: false → true
    + secretScanning: true
    (unchanged: hasIssues, allowSquashMerge, ...)

  ⚠️  Warning: visibility change (private → public) will expose repository

Repository: org/other-repo
  Settings: (no changes)
```

### Symbols

- `~` property changed (show old → new)
- `+` property being set (wasn't managed before)
- `-` property being removed

### Warnings

- `visibility` changes (any direction)
- `archived: true` (makes repo read-only)
- Disabling features with existing content

### Summary

```
Repo Settings Summary:
  3 repositories with changes
  2 repositories unchanged

  Changes: 5 properties to update, 2 to add
  Warnings: 1 visibility change, 1 archive
```

## Error Handling

### API Errors

| Error                    | Cause                           | Handling                                      |
| ------------------------ | ------------------------------- | --------------------------------------------- |
| 404 Not Found            | Repo doesn't exist or no access | Skip repo, log warning, continue              |
| 403 Forbidden            | Insufficient permissions        | Skip repo, log error with required permission |
| 422 Unprocessable        | Invalid setting combination     | Fail with clear message                       |
| 403 on security features | Requires GHAS license           | Log warning, skip setting, continue           |

### Partial Failure Strategy

Process all repos, collect errors, report at end:

```typescript
interface RepoSettingsResult {
  repo: string;
  success: boolean;
  changes: PropertyChange[];
  warnings: string[];
  errors: string[];
}
```

If one repo fails, others still process. Final exit code reflects any failures.

### Idempotency

Re-running with same config = no changes. Safe to run repeatedly.

## Testing Strategy

### Unit Tests

| Test File                              | Coverage                                   |
| -------------------------------------- | ------------------------------------------ |
| `repo-settings-diff.test.ts`           | Diff algorithm: changes, additions, no-ops |
| `repo-settings-plan-formatter.test.ts` | Output formatting, warnings, summary       |
| `config-validator.test.ts`             | Repo settings validation cases             |
| `config-normalizer.test.ts`            | Inheritance/merge of settings              |

### Integration Tests

Extend `github-settings.test.ts`:

- Updates merge options
- Enables security features
- Handles visibility change
- Dry-run shows correct diff
- Idempotent on re-run

### Edge Cases

- Empty `repo: {}` (no-op)
- Only security settings (separate API calls)
- GitHub Enterprise host
- Repo without required permissions

## Documentation Updates

### GitHub Pages Docs (`docs/`)

| File                                  | Changes                                                                     |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `docs/configuration/repo-settings.md` | **New file** - Full guide for repo settings (mirrors rulesets.md structure) |
| `docs/configuration/index.md`         | Add repo settings to configuration overview                                 |
| `docs/commands/settings.md`           | Update to cover repo settings alongside rulesets                            |
| `docs/getting-started.md`             | Add example showing repo settings in quick start                            |

### Documentation Content

`docs/configuration/repo-settings.md` should include:

- Overview of supported settings
- Config schema with all properties
- Inheritance behavior (root vs per-repo)
- Examples for common use cases (enforce squash merge, enable security features)
- Warnings section for dangerous operations
- Troubleshooting (permissions, GHAS requirements)

## Schema Updates

### JSON Schema (`config-schema.json`)

Add `repo` object definition under `settings`:

```json
{
  "settings": {
    "properties": {
      "rulesets": { ... },
      "repo": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "hasIssues": { "type": "boolean" },
          "hasProjects": { "type": "boolean" },
          "hasWiki": { "type": "boolean" },
          "hasDiscussions": { "type": "boolean" },
          "isTemplate": { "type": "boolean" },
          "allowForking": { "type": "boolean" },
          "visibility": { "enum": ["public", "private", "internal"] },
          "archived": { "type": "boolean" },
          "allowSquashMerge": { "type": "boolean" },
          "allowMergeCommit": { "type": "boolean" },
          "allowRebaseMerge": { "type": "boolean" },
          "allowAutoMerge": { "type": "boolean" },
          "deleteBranchOnMerge": { "type": "boolean" },
          "allowUpdateBranch": { "type": "boolean" },
          "squashMergeCommitTitle": { "enum": ["PR_TITLE", "COMMIT_OR_PR_TITLE"] },
          "squashMergeCommitMessage": { "enum": ["PR_BODY", "COMMIT_MESSAGES", "BLANK"] },
          "mergeCommitTitle": { "enum": ["PR_TITLE", "MERGE_MESSAGE"] },
          "mergeCommitMessage": { "enum": ["PR_BODY", "PR_TITLE", "BLANK"] },
          "vulnerabilityAlerts": { "type": "boolean" },
          "automatedSecurityFixes": { "type": "boolean" },
          "secretScanning": { "type": "boolean" },
          "secretScanningPushProtection": { "type": "boolean" },
          "privateVulnerabilityReporting": { "type": "boolean" }
        }
      }
    }
  }
}
```

Schema must be updated in both:

1. Root-level `settings.repo`
2. Per-repo `repos[].settings.repo`
