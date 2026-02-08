# Repo Settings Opt-Out Design

## Problem

Repos can opt out of rulesets (`rulesetName: false` or `inherit: false`) but there is no equivalent mechanism for the `repo` settings block. We need a way for a repo to skip all root-level repo settings.

## Solution

Add blanket opt-out support: `repo: false` at the per-repo level skips all root-level repo settings for that repo.

## Config Syntax

```yaml
settings:
  repo:
    hasWiki: true
    hasIssues: true
    allowSquashMerge: true

repos:
  - git: https://github.com/org/repo-a.git
    # Inherits all repo settings normally

  - git: https://github.com/org/repo-b.git
    settings:
      repo: false # Opts out of ALL root repo settings
```

## Type Changes (`config.ts`)

`RawRepoSettings.repo` changes from `GitHubRepoSettings` to `GitHubRepoSettings | false`:

```typescript
export interface RawRepoSettings {
  rulesets?: Record<string, Ruleset | false> & { inherit?: boolean };
  repo?: GitHubRepoSettings | false; // add | false
  deleteOrphaned?: boolean;
}
```

The normalized `RepoSettings` interface stays unchanged — `false` is stripped during normalization.

## Normalizer Changes (`config-normalizer.ts`)

In `mergeSettings()`, check if per-repo `repo` is `false`:

```typescript
if (perRepo?.repo === false) {
  // Opt-out: don't include any repo settings
} else {
  const mergedRepo = { ...(root?.repo ?? {}), ...(perRepo?.repo ?? {}) };
  if (Object.keys(mergedRepo).length > 0) {
    result.repo = mergedRepo as GitHubRepoSettings;
  }
}
```

## Validator Changes (`config-validator.ts`)

1. **Root-level `repo: false` is an error** — nothing to opt out of at root level.
2. **Per-repo `repo: false` is valid** — skip repo settings validation for that repo.
3. **Per-repo `repo: false` without root repo settings is an error** — opting out of nothing, consistent with rulesets validation.

## Processor Impact

No changes needed. `RepoSettingsProcessor` already skips repos with no `repo` settings:

```typescript
if (!desiredSettings || Object.keys(desiredSettings).length === 0) {
  return { skipped: true };
}
```

## Tests

### Config Normalizer (`config-normalizer.test.ts`)

- `repo: false` at per-repo level produces no repo settings in merged output
- `repo: false` at per-repo level still allows rulesets to be inherited
- `repo: false` with root repo settings — root settings are excluded
- `repo: false` without root repo settings — still produces no repo settings

### Config Validator (`config-validator.test.ts`)

- `repo: false` at root level throws error
- `repo: false` at per-repo level with root repo settings — valid
- `repo: false` at per-repo level without root repo settings — throws error

### Repo Settings Processor (`repo-settings-processor.test.ts`)

- Repo with normalized empty repo settings — processor returns `{ skipped: true }`
