# Design: Unified Command & Simplified State (v4)

**Date:** 2026-03-02
**Status:** Draft
**Breaking:** Yes (major version bump to v4)

## Problem

The current architecture has two commands (`sync` and `settings`) with separate state management paths:

1. `sync` clones target repos, writes files, updates `.xfg.json` manifest, commits, and creates a PR.
2. `settings` applies rulesets/labels/repo-settings via API, then clones the target repo _again_ just to update `.xfg.json` — creating separate PRs (`chore/sync-rulesets`, `chore/sync-labels`).

This causes:

- **Up to 3 PRs per repo per run** (sync + rulesets manifest + labels manifest)
- **Branch conflicts** between settings manifest PRs and sync PRs
- **Unnecessary clones** for settings-only manifest updates
- **Complexity** from `ManifestStrategy`, `updateManifestOnly()`, and separate orchestration code
- **Timing mismatch** — settings apply immediately via API, but the manifest update is deferred until the PR merges

## Solution

### 1. Unified Command

Remove the `settings` command. `xfg sync` becomes the only command, processing files and settings in a single pass per repo.

**Flow per repo:**

1. Clone repo (once)
2. Write files to working tree
3. Apply rulesets via API
4. Apply labels via API
5. Apply repo settings via API
6. Update manifest (files only) in working tree
7. Commit everything
8. Push / create PR

One clone, one branch, one PR.

### 2. Manifest Tracks Files Only

The `.xfg.json` manifest drops the `rulesets` and `labels` arrays. It only tracks files with `deleteOrphaned: true`.

```json
{
  "version": 4,
  "configs": {
    "my-org-config": {
      "files": [".eslintrc.json", ".prettierrc.json"]
    }
  }
}
```

Multi-config namespacing is preserved (two xfg configs can manage the same repo without conflict).

### 3. Desired-State Full-Replace for Rulesets & Labels

Instead of tracking managed rulesets/labels in a manifest and diffing, use a desired-state model:

**Rulesets** (when `settings.rulesets` is declared AND `deleteOrphaned: true`):

1. List all rulesets on the repo via API
2. Compare to rulesets in the current config
3. Delete any rulesets not in config

If no `settings.rulesets` section exists for a repo, rulesets are not touched.

**Labels** (when `settings.labels` is declared AND `deleteOrphaned: true`):

1. List all labels on the repo via API
2. Compare to labels in the current config
3. Delete any labels not in config

If no `settings.labels` section exists for a repo, labels are not touched.

**Repo settings** remain unchanged — idempotent API calls with no orphan concept.

This eliminates the timing mismatch: settings and their orphan cleanup both happen immediately via API, independent of whether the file PR merges.

### 4. Versioned Documentation

Add versioned docs using `mike` (MkDocs Material built-in support) so v3 docs remain accessible alongside v4.

**`mkdocs.yml` addition:**

```yaml
extra:
  version:
    provider: mike
    alias: true
```

**Deployment:**

- Freeze current docs as `3.x` with `latest` alias
- v4 docs deployed as `4.x`
- On v4 release, move `latest` alias to `4.x`

Each version lives in a subdirectory on `gh-pages` (e.g., `/3.x/`, `/4.x/`). A version dropdown selector appears in the header automatically.

## What Gets Removed

| Component                                                 | Reason                                      |
| --------------------------------------------------------- | ------------------------------------------- |
| `settings-command.ts`                                     | Entire command eliminated                   |
| `ManifestStrategy` class                                  | No longer needed (no manifest-only commits) |
| `updateManifestOnly()` on `RepositoryProcessor`           | No separate manifest update path            |
| `chore/sync-rulesets` branch                              | No separate settings PRs                    |
| `chore/sync-labels` branch                                | No separate settings PRs                    |
| `fetchManagedRulesets()` / `fetchManagedLabels()`         | No manifest reads for settings              |
| `rulesets` / `labels` fields in manifest schema           | Manifest is files-only                      |
| `process-rulesets.ts` / `process-labels.ts` orchestration | Logic moves into unified sync flow          |

## What Changes

| Component                 | Change                                                         |
| ------------------------- | -------------------------------------------------------------- |
| `sync-command.ts`         | Orchestrates settings alongside file sync                      |
| `repository-processor.ts` | Single `process()` method handles everything                   |
| `manifest.ts`             | Version bumped to 4, `rulesets`/`labels` fields removed        |
| Rulesets processor        | Orphan detection via API list + config diff (no manifest read) |
| Labels processor          | Same: API list + config diff                                   |
| `mkdocs.yml`              | Add `mike` versioning configuration                            |
| Docs deploy workflow      | Use `mike deploy` instead of `mkdocs gh-deploy`                |

## Breaking Changes (v4)

- `xfg settings` command removed — use `xfg sync` (settings block in config still works)
- `.xfg.json` version bumped to 4 — `rulesets`/`labels` fields ignored
- `deleteOrphaned: true` on rulesets/labels now means "delete ALL rulesets/labels not in config" (desired-state model) rather than "delete rulesets/labels that were previously tracked in the manifest"
- Users who had rulesets/labels not managed by xfg alongside xfg-managed ones must now either: (a) add all rulesets/labels to config, or (b) set `deleteOrphaned: false`

## Config Schema Changes

### CLI (`program.ts`)

- Remove the `settings` subcommand entirely
- Move settings-relevant shared options to the `sync` subcommand (they already share `SharedOptions`)
- The `sync` subcommand now runs both file sync and settings in one pass

### Config YAML Schema (`config-schema.json`)

No changes to the config YAML schema itself. The `settings` block (`rootSettings`, `repoSettings`) remains valid — it's just processed by `sync` instead of a separate command. The `id`, `files`, `settings`, `groups`, `repos`, `prOptions` structure is unchanged.

The only schema-adjacent change: the `anyOf` constraint at root (`at least one of: files, settings, groups`) remains, allowing configs with only `settings` and no `files`.

### Manifest Schema (`.xfg.json`)

```typescript
// V4 - files only
interface XfgManifestConfigEntry {
  files?: string[];
  // rulesets and labels fields removed
}

interface XfgManifest {
  version: 4;
  configs: Record<string, XfgManifestConfigEntry>;
}
```

Migration on load: V3 manifests with `rulesets`/`labels` fields are loaded normally — the extra fields are ignored. The manifest is overwritten as V4 on the next sync run.

### `action.yml`

- Remove the `command` input (no longer needed — only `sync` exists)
- Remove the `if [ "${{ inputs.command }}" = "sync" ]` guard on sync-only flags
- All inputs apply to the single `xfg sync` invocation

### Validator Changes

- Remove `validateForSettings()` — no separate settings validation path
- `validateForSync()` relaxed: allow configs with only `settings` (no `files`), since sync now handles both
- Or rename to just `validateConfig()` since there's only one command

## Integration Test Changes

### Tests to merge/restructure

The current test split mirrors the two-command architecture:

| Current test                              | v4 treatment                                                      |
| ----------------------------------------- | ----------------------------------------------------------------- |
| `github.test.ts` (sync)                   | Remains, expanded to also verify settings are applied during sync |
| `github-app.test.ts` (sync + app auth)    | Remains                                                           |
| `github-rulesets.test.ts` (settings)      | Merged: rulesets tested as part of sync run, not standalone       |
| `github-repo-settings.test.ts` (settings) | Merged: repo settings tested as part of sync run                  |
| `github-labels.test.ts` (settings)        | Merged: labels tested as part of sync run                         |
| `github-lifecycle.test.ts`                | Unchanged                                                         |
| `github-lifecycle-app.test.ts`            | Unchanged                                                         |
| `ado.test.ts`                             | Unchanged (ADO has no settings support)                           |
| `gitlab.test.ts`                          | Unchanged (GitLab has no settings support)                        |

### New test scenarios

1. **Unified sync + settings in one run**: Config with both `files` and `settings` — verify files are written AND settings are applied in a single invocation, with one PR.
2. **Settings-only config**: Config with `settings` but no `files` — verify settings are applied and manifest is updated in one clone/PR.
3. **Desired-state orphan deletion for rulesets**: Create rulesets manually, run sync with a config that doesn't include them + `deleteOrphaned: true` — verify they're deleted.
4. **Desired-state orphan deletion for labels**: Same pattern for labels.
5. **No labels section = labels untouched**: Repo has existing labels, config has no `settings.labels` — verify labels are not deleted.
6. **deleteOrphaned: false preserves extra rulesets/labels**: Rulesets/labels exist that aren't in config, `deleteOrphaned: false` — verify they survive.

### Test helpers

- Remove `waitForManifestLabels()` / `waitForManifestRulesets()` — manifest no longer tracks these
- Add `listRulesets()` / `listLabels()` helpers that query the GitHub API directly
- Update `resetTestRepo()` to also reset labels (already partially done)

### CI workflow

- Remove separate settings integration test jobs (`integration-github-rulesets`, `integration-github-repo-settings`, `integration-github-labels`)
- Fold settings assertions into the main `integration-github` job, or keep as a separate `integration-github-settings` job that runs `xfg sync` with settings-only configs

## Migration (v3 → v4)

Clean break — no automatic migration.

- Old `.xfg.json` files with `rulesets`/`labels` fields are ignored (not deleted — users can clean up at their leisure, or the next sync run will overwrite with v4 format)
- Users update their CI from `xfg settings && xfg sync` to just `xfg sync`
- Users with `deleteOrphaned: true` on labels/rulesets should audit their repos to ensure all desired labels/rulesets are in config before upgrading
