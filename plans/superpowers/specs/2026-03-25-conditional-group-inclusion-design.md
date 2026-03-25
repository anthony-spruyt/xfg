# Conditional Group Inclusion (Group Dependencies)

**Issue:** [#651](https://github.com/anthony-spruyt/xfg/issues/651)
**Date:** 2026-03-25

## Problem

Some configuration only makes sense when two or more groups intersect. For example, a `renovate/terraform` label should only be added when a repo has both `terraform` and `renovate` groups. Currently this must be hardcoded in one group (adding orphaned config to repos without the other group) or maintained as inline per-repo overrides.

## Solution

A new top-level `conditionalGroups` array. Each entry is an anonymous conditional group with a `when` clause that determines activation based on which explicit groups a repo has. Matching conditional groups merge into the pipeline after explicit groups and before repo overrides.

### Config Schema

```yaml
conditionalGroups:
  - when:
      allOf: [terraform, renovate]
    settings:
      labels:
        "renovate/terraform":
          color: "#ededed"
          description: ""

  - when:
      anyOf: [github-ci, github-trivy]
    files:
      .github/actionlint.yaml:
        content: "@templates/.github/actionlint.yaml"

  - when:
      allOf: [renovate]
      anyOf: [go, terraform, typescript]
    settings:
      labels:
        "renovate/language":
          color: "#ededed"
```

### Type Definitions

```typescript
interface RawConditionalGroupWhen {
  allOf?: string[];
  anyOf?: string[];
}

interface RawConditionalGroupConfig {
  when: RawConditionalGroupWhen;
  files?: Record<string, RawFileConfig | RawRepoFileOverride | false> & { inherit?: boolean };
  prOptions?: PRMergeOptions;
  settings?: RawRepoSettings;
}

// Added to RawConfig:
conditionalGroups?: RawConditionalGroupConfig[];
```

### `when` Clause Semantics

- `allOf`: every listed group must be present in the repo's effective group set.
- `anyOf`: at least one listed group must be present.
- When both are specified, both conditions must be satisfied.
- At least one of `allOf` or `anyOf` must be present.
- Both must be non-empty string arrays when present.
- All referenced group names must exist in the `groups` map (hard validation error).
- Duplicate group names within an `allOf` or `anyOf` array are rejected as validation errors.
- A group name appearing in both `allOf` and `anyOf` is allowed (the `anyOf` entry is redundant but harmless).

### Resolution Pipeline

Per-repo resolution becomes four phases:

```text
Phase 1: Resolve explicit groups (existing)
  root files/prOptions/settings -> merge each explicit group L->R
  Uses existing mergeGroupFiles, mergeGroupPROptions, mergeGroupSettings

Phase 2: Determine effective group set
  Collect the repo's explicit group names
  (Future #649: expand with transitive extends before this point)

Phase 3: Evaluate and merge conditional groups
  For each conditionalGroup in array order:
    - Evaluate when clause against effective group set
    - If matched, merge files/prOptions/settings onto Phase 1 result
  Uses new mergeConditionalGroups function
  Conditional groups do NOT expand the effective group set (no chaining)

Phase 4: Apply repo overrides (existing)
  Merge per-repo files/prOptions/settings on top
```

The effective group set is frozen after Phase 2. All conditionals evaluate against the same set.

A repo with no `groups` field or `groups: []` has an empty effective group set. No conditional group can match (since `allOf` and `anyOf` both require at least one group to be present).

### Future #649 (extends) Interaction

When group `extends` lands (#649), the resolution order becomes:

1. Resolve `extends` chains (expand each group's transitive parents)
2. Build effective group set (explicit + transitive)
3. Evaluate conditional groups against the expanded set

This means `when: { anyOf: [github] }` will match a repo with `groups: [github-ci]` if `github-ci` extends `github`. The pipeline is designed to accommodate this by keeping condition evaluation as a separate phase that operates on the effective group set, regardless of how that set was built.

### Merge Semantics

Conditional groups have full parity with regular groups:

- **Files:** `inherit: false`, `override: true`, `file: false` all work. Conditional group files use the same type as regular groups (`RawFileConfig | RawRepoFileOverride | false` with `inherit?: boolean`), so `mergeStrategy` can be set on files introduced by conditional groups.
- **PR Options:** later values win, same as regular group merging. A conditional group with only `prOptions` (no files or settings) is valid.
- **Settings:** `inherit: false` on rulesets/labels, deep merge otherwise. `repo` settings follow the same rules as regular groups (including `repo: false` opt-out).

A new `mergeConditionalGroups` function handles the conditional phase. It:

- Accepts accumulated state from Phase 1 (effective files as `Record<string, RawFileConfig>`, effective PR options as `PRMergeOptions | undefined`, effective settings as `RawRootSettings | undefined`), the effective group set, and the `conditionalGroups` array.
- Returns the updated accumulated state (same shape as input) after merging all matching conditional groups.
- Evaluates each conditional group's `when` clause.
- For matching groups, delegates to the same merge primitives used by regular group merging (`mergeContentPair`, `mergePROptions`, `mergeRawSettings`, etc.).
- Does not modify the existing `mergeGroupFiles`/`mergeGroupPROptions`/`mergeGroupSettings` functions.

### Orphan Deletion

Files introduced by conditional groups are tracked in the manifest like any other managed file.
If a repo's group membership changes such that a conditional group no longer matches,
files it previously introduced become orphans and are handled by the existing
`deleteOrphaned` mechanism. No special handling needed — the manifest system operates
on the final resolved file set, which naturally excludes files from non-matching
conditional groups.

### Validation

Added to the existing validator:

1. **`when` clause:**
   - `when` is required on each conditional group entry.
   - At least one of `allOf` or `anyOf` must be present.
   - Both must be non-empty string arrays when present.
   - Every referenced group name must exist in the `groups` map (hard error).
   - Duplicate group names within `allOf` or `anyOf` are rejected.

2. **Content:**
   - `files`, `prOptions`, `settings` validated with the same rules as regular groups (reuse existing validation functions).
   - `repo` settings within conditional groups follow the same rules as regular groups (including `repo: false` opt-out).

3. **"Has content" guards:**
   - `validateRawConfig` and `validateForSync` check whether the config has actionable content (files or settings). These guards must also inspect `conditionalGroups` entries — a config with only `conditionalGroups` (no root files, no root settings, no regular group content) is valid if those conditional groups contain files, settings, or prOptions.

4. **`knownFiles` and `rootCtx` expansion:**
   - `validateRepoFiles` builds a `knownFiles` set from root files and explicit group files. This set must also include files from ALL conditional groups (unconditionally, regardless of `when` clause evaluation). This avoids false "undefined file" errors when a repo overrides a file introduced by a conditional group.
   - Similarly, `validateRepoSettingsEntry` builds a `rootCtx` from root settings and explicit group settings. This context must include rulesets/labels and `hasRepoSettings` from all conditional groups so that repos can opt out of conditional group settings (e.g., `ruleset: false`, `repo: false`).
   - This is intentionally over-permissive at validation time (a repo could override a file from a conditional group that doesn't match it). The runtime handles actual activation. This is acceptable because the alternative (statically resolving which conditionals apply per repo) adds significant complexity for minimal benefit.

5. **No static cross-validation:**
   - No attempt to statically determine which conditional groups apply to which repos during validation. The runtime handles activation.

### Testing Strategy

**Condition evaluation:**
- `allOf` only: all present matches, any missing doesn't.
- `anyOf` only: one present matches, none present doesn't.
- Both `allOf` + `anyOf`: both satisfied matches, either failing doesn't.

**Merge pipeline:**
- No conditional groups defined: existing behavior unchanged.
- Single matching conditional group merges files/settings/prOptions.
- Multiple matching conditional groups merge in array order.
- Non-matching conditional groups are skipped.
- Conditional groups merge after explicit groups, before repo overrides.
- Repo overrides win over conditional group values.
- `inherit: false`, `override: true`, `file: false` work within conditional groups.

**Validation:**
- Missing `when`: error.
- Empty `when` (neither `allOf` nor `anyOf`): error.
- Non-existent group in `allOf`/`anyOf`: error.
- Duplicate group names in `allOf`/`anyOf`: error.
- Valid conditional group: passes.
- Files/settings validated same as regular groups.
- Config with only `conditionalGroups` (no root files/settings): valid.
- Repo overriding a file from a conditional group: valid (knownFiles expanded).
- Repo opting out of a ruleset from a conditional group: valid (rootCtx expanded).
- Conditional group with only `prOptions`: valid.

**Integration tests:**
- End-to-end: config with conditional groups produces correct files/settings on matching repos and no effect on non-matching repos.

### Documentation

Update `docs/configuration/groups.md` on GitHub Pages with:
- New "Conditional Groups" section explaining the `conditionalGroups` array.
- `when` clause syntax and semantics (`allOf`, `anyOf`, combinable).
- Examples covering intersection (allOf), union (anyOf), and combined cases.
- Merge order explanation (after explicit groups, before repo overrides). Note that array order determines merge precedence — later entries override earlier ones.
- Note that conditional groups cannot be referenced by name or listed in repo `groups` arrays.
