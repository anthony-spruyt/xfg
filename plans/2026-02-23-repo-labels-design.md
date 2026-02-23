# Design: Manage Repo Labels (#522)

## Overview

Add declarative label management to xfg's `settings` command. Labels are defined in config and synced to GitHub repositories — creating, updating, renaming, and deleting labels to match the desired state. Follows the same architecture as rulesets.

GitHub-only initially, with an `ILabelsStrategy` interface for future GitLab support.

Related issues: #522, #129

## Config Schema

### Label Type

```typescript
interface Label {
  color: string; // hex, with or without # (stripped on normalization)
  description?: string; // max 100 chars (GitHub limit)
  new_name?: string; // optional rename target (maps to GitHub API new_name)
}
```

### Config Shape

Key = current label name on GitHub (maps to `{name}` in API path).
Fields map directly to the GitHub PATCH request body (`new_name`, `color`, `description`).

```yaml
# Root-level — applied to all repos
settings:
  labels:
    bug:
      color: "d73a4a"
      description: "Something isn't working"
    enhancement:
      color: "a2eeef"
      description: "New feature or request"
  deleteOrphaned: true

repos:
  # Inherits all root labels
  - git: org/repo-a

  # Opt out of all root labels
  - git: org/repo-b
    settings:
      labels:
        inherit: false
        deploy:
          color: "0e8a16"

  # Opt out of specific label
  - git: org/repo-c
    settings:
      labels:
        enhancement: false

  # Override a label's color
  - git: org/repo-d
    settings:
      labels:
        bug:
          color: "ff0000"

  # Rename a label
  - git: org/repo-e
    settings:
      labels:
        old-name:
          new_name: "new-name"
          color: "d73a4a"
```

### Inheritance

Follows the same pattern as rulesets:

- `inherit: false` — opt out of all root labels
- `label_name: false` — opt out of a specific root label
- Per-repo labels deep merge with root labels (per-repo overrides root)

### Color Format

Accepts both `d73a4a` and `#d73a4a`. The `#` prefix is stripped during normalization.

### JSON Schema Addition

New `label` definition in `config-schema.json`:

```json
"label": {
  "type": "object",
  "description": "GitHub label configuration",
  "required": ["color"],
  "properties": {
    "color": {
      "type": "string",
      "pattern": "^#?[0-9a-fA-F]{6}$",
      "description": "Hex color code (with or without #). Example: 'd73a4a' or '#d73a4a'"
    },
    "description": {
      "type": "string",
      "maxLength": 100,
      "description": "Label description (max 100 characters)"
    },
    "new_name": {
      "type": "string",
      "description": "Rename this label. Maps to GitHub API's new_name field."
    }
  }
}
```

`labels` added to `repoSettings` alongside `rulesets`, with `inherit` and `false` opt-out support.

## Architecture

### Module Structure

```
src/settings/labels/
├── index.ts                      # barrel exports
├── types.ts                      # ILabelsStrategy, GitHubLabel, GitHubLabelPayload
├── processor.ts                  # LabelsProcessor, ILabelsProcessor, result types
├── github-labels-strategy.ts     # GitHub implementation via gh api
├── diff.ts                       # diffLabels()
├── formatter.ts                  # formatLabelsPlan()
└── converter.ts                  # normalizeColor(), configToGitHub()
```

### Strategy Interface (`types.ts`)

```typescript
interface LabelsStrategyOptions {
  token?: string;
  host?: string;
}

interface GitHubLabel {
  id: number;
  name: string;
  color: string;
  description: string | null;
  default: boolean;
}

interface GitHubLabelPayload {
  name?: string;
  new_name?: string;
  color?: string;
  description?: string;
}

interface ILabelsStrategy {
  list(
    repoInfo: RepoInfo,
    options?: LabelsStrategyOptions
  ): Promise<GitHubLabel[]>;
  create(
    repoInfo: RepoInfo,
    label: GitHubLabelPayload,
    options?: LabelsStrategyOptions
  ): Promise<void>;
  update(
    repoInfo: RepoInfo,
    currentName: string,
    label: GitHubLabelPayload,
    options?: LabelsStrategyOptions
  ): Promise<void>;
  delete(
    repoInfo: RepoInfo,
    name: string,
    options?: LabelsStrategyOptions
  ): Promise<void>;
}
```

### GitHub API Mapping

| Operation | Endpoint                                     | Notes                                       |
| --------- | -------------------------------------------- | ------------------------------------------- |
| List      | `GET /repos/{owner}/{repo}/labels`           | Paginated                                   |
| Create    | `POST /repos/{owner}/{repo}/labels`          | Body: `{ name, color, description }`        |
| Update    | `PATCH /repos/{owner}/{repo}/labels/{name}`  | Body: `{ new_name?, color?, description? }` |
| Delete    | `DELETE /repos/{owner}/{repo}/labels/{name}` |                                             |

### Auth

Same pattern as rulesets/repo-settings:

- Constructor checks `hasGitHubAppCredentials()` → creates `GitHubAppTokenManager` or null
- `process()` resolves effective token: `token ?? (await this.getInstallationToken(repo))`
- Strategy sets `GH_TOKEN=<token>` env prefix on `gh api` commands

### Processor Result

```typescript
interface LabelsProcessorOptions {
  dryRun: boolean;
  managedLabels?: string[];
  noDelete: boolean;
  token?: string;
}

interface LabelsProcessorResult {
  success: boolean;
  repoName: string;
  message: string;
  skipped?: boolean;
  dryRun?: boolean;
  changes?: {
    create: number;
    update: number;
    delete: number;
    unchanged: number;
  };
  manifestUpdate?: {
    labels: string[];
  };
  planOutput?: LabelsPlanResult;
}
```

### Processing Flow

1. Skip if not GitHub repo
2. Fetch current labels from API (`GET /repos/{owner}/{repo}/labels`)
3. Normalize desired config (strip `#` from colors)
4. `diffLabels()` — compare current vs desired
5. Format plan via `formatLabelsPlan()`
6. If dry-run: return plan only
7. Apply changes: create/update/delete via strategy (renames use `new_name`)
8. Compute manifest update for `deleteOrphaned`
9. Return result

## Diff Logic

```typescript
function diffLabels(
  current: GitHubLabel[],
  desired: Record<string, Label>,
  managedLabels: string[],
  noDelete: boolean
): LabelChange[];
```

Matching: case-insensitive by name (GitHub label names are case-insensitive).

Color comparison: case-insensitive bare hex (strip `#`, lowercase both sides).

Change types:

- **create** — desired name not in current
- **update** — exists but color, description, or `new_name` differs
- **delete** — in `managedLabels` but not in desired, `deleteOrphaned` enabled, `noDelete` false
- **unchanged** — exists and all properties match

## Formatter Output

Terraform-style plan:

```
  + label "deploy"
      color: "0e8a16"
      description: "Deployment related"

  ~ label "bug"
      color: "d73a4a" → "ff0000"

  ~ label "old-name" → "new-name"
      color: "d73a4a"

  - label "stale"

Plan: 3 labels (1 to create, 1 to update, 1 to delete)
```

## Integration Points

### Settings Command (`settings-command.ts`)

- Add `reposWithLabels` filter
- Add `processLabels()` function (same shape as `processRulesets()`)
- Update `runSettings()` — add `labelsProcessorFactory` parameter
- Update "no settings" check and total counter

### Report Builder (`settings-report-builder.ts`)

- Add `labelsResult` to `ProcessorResults`
- Add `labels` to `RepoChanges` and totals

### Settings Report (`settings-report.ts`)

- Add `LabelChange` type
- Add labels to `SettingsReport.totals`
- Update CLI and markdown formatters

### Manifest (`sync/manifest.ts`)

- Add `getManagedLabels()` and `updateManifestLabels()`
- Manifest config entry gets `labels?: string[]`

### Validator (`config/validator.ts`)

- Add `validateLabels()` — color format, description length, reserved `inherit` key
- Update `validateForSettings()` — include labels in "has actionable config" check

### Normalizer (`config/normalizer.ts`)

- Add `mergeLabels()` — same pattern as rulesets merge
- Strip `#` from color values
- Support `inherit: false` and `label: false` opt-out

### CLI Types (`cli/types.ts`)

- Add `LabelsProcessorFactory` and `defaultLabelsProcessorFactory`

### Coverage (`package.json`)

- Add `--exclude='src/settings/labels/types.ts'` to `test:coverage` c8 command

## Files Changed

### New Files (12)

| File                                            | Purpose                                 |
| ----------------------------------------------- | --------------------------------------- |
| `src/settings/labels/index.ts`                  | Barrel exports                          |
| `src/settings/labels/types.ts`                  | Strategy interface, API types           |
| `src/settings/labels/processor.ts`              | Processor + result types                |
| `src/settings/labels/github-labels-strategy.ts` | GitHub implementation                   |
| `src/settings/labels/diff.ts`                   | Diff logic                              |
| `src/settings/labels/formatter.ts`              | Plan formatter                          |
| `src/settings/labels/converter.ts`              | Color normalization, payload conversion |
| `test/unit/labels-diff.test.ts`                 | Diff tests                              |
| `test/unit/labels-formatter.test.ts`            | Formatter tests                         |
| `test/unit/labels-converter.test.ts`            | Converter tests                         |
| `test/unit/labels-processor.test.ts`            | Processor tests                         |
| `docs/configuration/labels.md`                  | Labels documentation page               |

### Modified Files (17)

| File                                  | Change                                                 |
| ------------------------------------- | ------------------------------------------------------ |
| `src/config/types.ts`                 | Add `Label`, update `RawRepoSettings`/`RepoSettings`   |
| `src/config/normalizer.ts`            | Add `mergeLabels()`                                    |
| `src/config/validator.ts`             | Add `validateLabels()`, update `validateForSettings()` |
| `config-schema.json`                  | Add `label` definition, `labels` to `repoSettings`     |
| `src/cli/settings-command.ts`         | Add `processLabels()`, update `runSettings()`          |
| `src/cli/types.ts`                    | Add `LabelsProcessorFactory`                           |
| `src/cli/settings-report-builder.ts`  | Add labels to `ProcessorResults` and totals            |
| `src/output/settings-report.ts`       | Add `LabelChange`, update formatters                   |
| `src/sync/manifest.ts`                | Add `getManagedLabels()`, `updateManifestLabels()`     |
| `package.json`                        | Exclude labels types.ts from coverage                  |
| `mkdocs.yml`                          | Add Labels nav entry                                   |
| `docs/configuration/index.md`         | Reference labels                                       |
| `docs/configuration/inheritance.md`   | Add labels inheritance examples                        |
| `docs/configuration/repo-settings.md` | Mention labels                                         |
| `docs/platforms/github.md`            | Add labels to supported features                       |
| `docs/reference/config-schema.md`     | Add Label Config table                                 |
| Existing test files                   | Update report builder, validator, normalizer tests     |

## Testing

### New Unit Tests

| Test                       | Coverage                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `labels-diff.test.ts`      | create, update, delete, unchanged, rename, case-insensitive, deleteOrphaned, noDelete |
| `labels-formatter.test.ts` | Each action type, rename display, summary line                                        |
| `labels-converter.test.ts` | normalizeColor (strip #, lowercase), configToGitHub payload                           |
| `labels-processor.test.ts` | Mocked strategy, dry-run, skip non-GitHub, auth token, manifest                       |

### Updated Tests

- `settings-report-builder.test.ts` — labels in ProcessorResults
- `config-validator.test.ts` — labels validation
- `config-normalizer.test.ts` — mergeLabels

### Integration Tests

- Add labels fixture to `test:integration:github`
- Verify create, update, delete, rename via real API
- Verify deleteOrphaned with manifest

## Follow-Up

- Create issue: `feat: GitLab label management support` — implement `GitLabLabelsStrategy`
