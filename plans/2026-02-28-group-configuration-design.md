# Design: Group Configuration for Repos

**Date:** 2026-02-28
**Status:** Draft
**Issue:** #135

## Problem Statement

Root-level config becomes clunky when managing diverse repo types (C# APIs, C# message processors, Node/TS projects, Claude plugins, etc.). A thin root with per-repo overrides leads to heavy duplication when subsets of repos need different shared configs. There is no middle layer between root and per-repo config.

## Design

### Config Syntax

Top-level `groups` map defines named config bundles. Repos reference groups via `groups: [...]`. Order matters — later groups override earlier ones.

```yaml
# Root — thin base, applies to everything
id: my-org
files:
  .editorconfig:
    content: "@templates/editorconfig"

# Named config layers
groups:
  csharp:
    files:
      .editorconfig:
        content: "@templates/csharp-editorconfig"
      Directory.Build.props:
        content: "@templates/directory-build-props"
    settings:
      rulesets:
        branch-protection:
          # ...

  api:
    files:
      Dockerfile:
        content: "@templates/api-dockerfile"
    prOptions:
      reviewers: ["platform-team"]

  node:
    files:
      tsconfig.json:
        content: "@templates/tsconfig.json"
      .prettierrc:
        content: { semi: true, singleQuote: true }

repos:
  - git: org/my-csharp-api
    groups: [csharp, api]
    # merge chain: root → csharp → api → this repo's overrides

  - git: [org/worker-a, org/worker-b]
    groups: [csharp]
    # both repos get: root → csharp

  - git: org/my-node-app
    groups: [node]
    files:
      tsconfig.json:
        content: { strict: true } # overrides group's tsconfig

  - git: org/simple-repo
    # no groups — just root config
```

### Groups Map Structure

- `groups` is a map (keys are group names, not an array with `name` fields)
- Each group can define `files`, `prOptions`, `settings` — full parity with root config
- Groups do not define `repos` — repos reference groups, not the other way around

### Merge Chain

For a repo with `groups: [csharp, api]`:

```
root → csharp → api → repo overrides
```

Each layer merges into the accumulated result using existing merge patterns:

**Files:**

1. Start with root `files`
2. For each group (left to right), merge group files onto accumulated set:
   - New files are added
   - Existing files are deep-merged (respecting `mergeStrategy`, `override`, `$arrayMerge`)
   - `file: false` removes a file from the accumulated set
   - `inherit: false` clears all accumulated files before adding the group's own
3. Repo overrides merge on top using the same rules

**prOptions:**

- `mergePROptions()` applied iteratively: root → group1 → group2 → repo. Per-field, later wins.

**Settings (rulesets, repo, labels):**

- `mergeSettings()` applied iteratively. `inherit: false` at any layer clears accumulated settings for that section. `ruleset: false` / `label: false` removes a specific item.

### `inherit: false` Semantics

| Where                                      | Effect                                                              |
| ------------------------------------------ | ------------------------------------------------------------------- |
| Group's `files.inherit: false`             | Group discards all files accumulated so far (root + earlier groups) |
| Repo's `files.inherit: false`              | Repo discards all files from root + all groups                      |
| Group's `settings.rulesets.inherit: false` | Group discards accumulated rulesets                                 |

Consistent rule: `inherit: false` always means "discard everything above me in the chain."

### Architecture

Groups are resolved inside `normalizeConfig()` (Approach A). The normalizer's existing root→repo merge logic is extracted into reusable layer-merge functions that can be called N times. Normalized output types are unchanged — groups dissolve during normalization. Nothing downstream changes.

**Pipeline:**

```
normalizeConfig(raw)
  ├─ expandGitArrays(raw.repos)
  ├─ resolveGroupConfigs(expandedRepos, raw.groups, raw)
  │    ├─ validateGroupReferences(repo, groups)
  │    ├─ mergeGroupChain(root, repo.groups, groups)
  │    │    ├─ mergeFileLayer(accumulated, groupFiles)
  │    │    ├─ mergePROptions(accumulated, groupPR)
  │    │    └─ mergeSettingsLayer(accumulated, groupSettings)
  │    └─ mergeRepoOverrides(groupMerged, repoOverrides)
  │         ├─ mergeFileLayer(accumulated, repoFiles)
  │         ├─ mergePROptions(accumulated, repoPR)
  │         └─ mergeSettingsLayer(accumulated, repoSettings)
  └─ interpolateAndFinalize(resolvedRepos)
```

**Extracted functions:**

| Function                    | Responsibility                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| `resolveGroupConfigs()`     | Orchestrates group resolution for all repos                                                  |
| `mergeGroupChain()`         | Merges root → group1 → group2 for a single repo                                              |
| `mergeFileLayer()`          | Merges one layer of files onto an accumulated set (extracted from existing normalizer logic) |
| `mergeSettingsLayer()`      | Same pattern for settings (extracted from existing merge logic)                              |
| `validateGroupReferences()` | Ensures all group names in a repo's `groups` array exist in the top-level `groups` map       |

### Type Changes

**New type:**

```typescript
interface RawGroupConfig {
  files?: Record<string, RawFileConfig>;
  prOptions?: PRMergeOptions;
  settings?: RawRootSettings;
}
```

**Modified types:**

```typescript
interface RawConfig {
  // ... existing fields ...
  groups?: Record<string, RawGroupConfig>; // new
}

interface RawRepoConfig {
  // ... existing fields ...
  groups?: string[]; // new — references to group names
}
```

Normalized `Config` and `RepoConfig` types are unchanged.

### Validation

**In `validateRawConfig()`:**

| Check                                       | Error                                             |
| ------------------------------------------- | ------------------------------------------------- |
| Group names are non-empty strings           | `"groups: group name must be a non-empty string"` |
| Group config structure is valid             | Reuse existing file/settings validators           |
| No reserved keys as group names (`inherit`) | `"groups: 'inherit' is a reserved name"`          |

**Per-repo validation:**

| Check                                        | Error                                           |
| -------------------------------------------- | ----------------------------------------------- |
| `groups` is an array of strings              | `"repos[N].groups must be an array of strings"` |
| Each group name references an existing group | `"repos[N].groups: group 'foo' is not defined"` |
| No duplicate group names in a repo's list    | `"repos[N].groups: duplicate group 'foo'"`      |

**`@file` resolution:** Walk group file `content` fields in `file-reference-resolver.ts`, same as root and repo content.

**`validateForSync()`:** Loosen gate — config with no root `files` but groups that define files is valid.

### Testing

**Normalizer unit tests (`config-normalizer.test.ts`):**

- Single group, single repo — basic merge
- Multiple groups, merge order — `groups: [a, b]`, b overrides a
- Group + repo overrides — repo wins
- Group `inherit: false` on files — discards root files
- Repo `inherit: false` on files — discards root + group files
- Group `file: false` — removes a root-level file
- Repo `file: false` — removes a group-level file
- Git array expansion with groups — both expanded repos get group config
- No groups field on repo — backward compatible
- Empty groups array — same as no groups
- Group with settings + rulesets — settings merge chain
- `override: true` at group level — replaces root file content
- `override: true` at repo level — replaces group file content

**Validator unit tests (`config-validator.test.ts`):**

- Valid group config passes
- Unknown group reference throws with repo index and group name
- Duplicate group in repo's list throws
- Reserved group name throws
- No root files but groups have files — `validateForSync` passes

**File reference resolver tests (`file-reference-resolver.test.ts`):**

- `@file` refs in group file content resolve correctly

**Integration tests:**

- Update one existing fixture to use groups — validates full pipeline (load → resolve refs → validate → normalize → sync)
