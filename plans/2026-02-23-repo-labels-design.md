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

`labels` added to `repoSettings` alongside `rulesets`, with `inherit` and `false` opt-out support:

```json
"labels": {
  "type": "object",
  "description": "Map of label names to configurations. Set a label to false to opt out. Set inherit: false to skip all inherited labels.",
  "properties": {
    "inherit": {
      "type": "boolean",
      "description": "Set to false to skip all inherited root labels. Default: true"
    }
  },
  "additionalProperties": {
    "oneOf": [
      {
        "type": "boolean",
        "const": false,
        "description": "Set to false to opt out of this inherited label"
      },
      {
        "$ref": "#/definitions/label"
      }
    ]
  }
}
```

### TypeScript Type Additions

```typescript
// In RawRepoSettings — add alongside rulesets:
labels?: Record<string, Label | false> & { inherit?: boolean };

// In RepoSettings (normalized) — add alongside rulesets:
labels?: Record<string, Label>;
```

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

| Operation | Endpoint                                     | Notes                                               |
| --------- | -------------------------------------------- | --------------------------------------------------- |
| List      | `GET /repos/{owner}/{repo}/labels`           | Use `gh api --paginate` (repos can have 30+ labels) |
| Create    | `POST /repos/{owner}/{repo}/labels`          | Body: `{ name, color, description }`                |
| Update    | `PATCH /repos/{owner}/{repo}/labels/{name}`  | Body: `{ new_name?, color?, description? }`         |
| Delete    | `DELETE /repos/{owner}/{repo}/labels/{name}` |                                                     |

**URL encoding:** Label names can contain spaces, emoji, and special characters. The `{name}` path parameter must be URL-encoded via `encodeURIComponent()` in PATCH and DELETE calls. Verify `gh api` auto-encoding behavior during implementation; if not handled, encode explicitly.

**Pagination:** The list endpoint returns max 100 labels per page. Use `gh api --paginate` to fetch all pages. This is the first usage of `--paginate` in the codebase.

### Auth

Same pattern as rulesets/repo-settings:

- Constructor checks `hasGitHubAppCredentials()` → creates `GitHubAppTokenManager` or null
- `process()` resolves effective token: `token ?? (await this.getInstallationToken(repo))`
- Strategy sets `GH_TOKEN=<token>` env prefix on `gh api` commands

### Processor Result

```typescript
interface LabelsProcessorOptions {
  configId: string;
  dryRun?: boolean;
  managedLabels: string[];
  noDelete?: boolean;
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
2. Fetch current labels from API (`GET /repos/{owner}/{repo}/labels` with `--paginate`)
3. Normalize desired config (strip `#` from colors)
4. `diffLabels()` — compare current vs desired, detect rename collisions
5. Format plan via `formatLabelsPlan()`
6. If dry-run: return plan only
7. Apply changes in order: **deletes first, then renames/updates, then creates** (prevents rename collisions with existing labels that are being removed)
8. Compute manifest update for `deleteOrphaned`
9. Return result

**Apply ordering rationale:** Deletes must run first so that renames targeting a name that was previously occupied succeed. Creates run last to avoid colliding with labels about to be renamed away.

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

**Description comparison:** `undefined` in config means "do not compare" (leave current value). An explicit empty string `""` means "set to empty." GitHub API returns `null` for labels without descriptions — treat `null` and `undefined` as equivalent when comparing (neither triggers an update).

Change types:

- **create** — desired name not in current
- **update** — exists but color, description, or `new_name` differs
- **delete** — in `managedLabels` but not in desired, `deleteOrphaned` enabled, `noDelete` false
- **unchanged** — exists and all properties match

### Rename Collision Detection

When `new_name` is set on a desired label, `diffLabels()` must check:

1. The target `new_name` does not collide with another current label (unless that label is being deleted or renamed away in the same diff)
2. Two labels don't rename to the same target name
3. No rename chains (A→B and B→C) — flag as error, require separate runs

If a collision is detected, the diff should return an error result rather than attempting the operation.

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

- Add `labels?: string[]` to `XfgManifestConfigEntry`
- Add `getManagedLabels()` and `updateManifestLabels()`
- Update existing `updateManifest()` to preserve `labels` property (currently only preserves `rulesets`)
- Update existing `updateManifestRulesets()` to preserve `labels` property (currently only preserves `files`)
- Without these sibling preservation updates, a files-only or rulesets-only sync would drop the `labels` array from the manifest

### Settings Command: Manifest Update Interface

`IRepositoryProcessor.updateManifestOnly()` currently accepts `{ rulesets: string[] }`. Expand to accept `{ rulesets?: string[], labels?: string[] }` so labels can use the same manifest commit mechanism.

### Validator (`config/validator.ts`)

- Add `validateLabels()` — color format, description length, reserved `inherit` key at root, opt-out of non-existent root labels
- Add labels validation block inside `validateSettings()` (parallel to rulesets block)
- Update `validateForSettings()` — include labels in "has actionable config" check
- Update `hasActionableSettings()` — labels-only configs must be considered actionable
- Update error message text to mention labels alongside rulesets

### Normalizer (`config/normalizer.ts`)

- Add labels merge logic within `mergeSettings()` — same pattern as rulesets merge (lines 91-130)
- Extract `mergeLabels()` helper for testability, called from `mergeSettings()`
- Strip `#` from color values during normalization
- Support `inherit: false` and `label: false` opt-out

**Color note:** GitHub API responses never include `#` in color values (e.g., `"f29513"` not `"#f29513"`), so normalization only applies to the config/desired side.

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

| File                                  | Change                                                                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/config/types.ts`                 | Add `Label`, add `labels` to `RawRepoSettings` and `RepoSettings`                                                                                                               |
| `src/config/normalizer.ts`            | Add `mergeLabels()` helper, call from `mergeSettings()`                                                                                                                         |
| `src/config/validator.ts`             | Add `validateLabels()`, update `validateSettings()`, `hasActionableSettings()`, error messages                                                                                  |
| `config-schema.json`                  | Add `label` definition, add `labels` to `repoSettings` with inherit/false support                                                                                               |
| `src/cli/settings-command.ts`         | Add `processLabels()`, update `runSettings()`, three-way emptiness check, total counter                                                                                         |
| `src/cli/types.ts`                    | Add `LabelsProcessorFactory`, expand `updateManifestOnly` manifest type                                                                                                         |
| `src/cli/settings-report-builder.ts`  | Add `labelsResult` to `ProcessorResults`, labels totals                                                                                                                         |
| `src/output/settings-report.ts`       | Add `LabelChange` to `RepoChanges`, update CLI + markdown formatters, summary                                                                                                   |
| `src/sync/manifest.ts`                | Add `labels` to `XfgManifestConfigEntry`, `getManagedLabels()`, `updateManifestLabels()`, update `updateManifest()` and `updateManifestRulesets()` to preserve `labels` sibling |
| `package.json`                        | Exclude `src/settings/labels/types.ts` from c8 coverage                                                                                                                         |
| `mkdocs.yml`                          | Add `Labels: configuration/labels.md` nav entry                                                                                                                                 |
| `docs/configuration/index.md`         | Reference labels in settings section                                                                                                                                            |
| `docs/configuration/inheritance.md`   | Add labels inheritance examples                                                                                                                                                 |
| `docs/configuration/repo-settings.md` | Mention labels as sibling settings feature                                                                                                                                      |
| `docs/platforms/github.md`            | Add labels to supported features list                                                                                                                                           |
| `docs/reference/config-schema.md`     | Add Label Config table                                                                                                                                                          |
| Existing test files                   | Update report builder, validator, normalizer tests                                                                                                                              |

## Testing

### New Unit Tests

| Test                       | Coverage                                                                                                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `labels-diff.test.ts`      | create, update, delete, unchanged, rename, case-insensitive, deleteOrphaned, noDelete, rename collision detection, rename chain detection, description null/undefined/empty equivalence |
| `labels-formatter.test.ts` | Each action type, rename display, summary line                                                                                                                                          |
| `labels-converter.test.ts` | normalizeColor (strip #, lowercase), configToGitHub payload, URL encoding of label names                                                                                                |
| `labels-processor.test.ts` | Mocked strategy, dry-run, skip non-GitHub, auth token, manifest, apply ordering (deletes → updates → creates), pagination (100+ labels)                                                 |

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
