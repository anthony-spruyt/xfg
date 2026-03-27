# Group Extends / Inheritance

**Issue:** [#649](https://github.com/anthony-spruyt/xfg/issues/649)
**Date:** 2026-03-27

## Problem

When shared configuration is extracted into base groups (e.g., a `github` group with actionlint config), repos that use derived groups (`github-ci`, `github-trivy`) must explicitly list both the base and derived group. Forgetting the base group silently omits shared config. This is error-prone and scales poorly as group hierarchies deepen.

## Solution

Add an `extends` field to `RawGroupConfig` that declares parent groups. When a repo references a group with `extends`, the normalizer automatically expands the group into its full inheritance chain (parents first, child last), so the repo gets all parent config without listing each ancestor explicitly.

### Config Schema

```yaml
groups:
  github:
    files:
      .github/actionlint.yaml:
        content: "@templates/.github/actionlint.yaml"

  github-ci:
    extends: github
    files:
      .github/workflows/ci.yaml:
        content: "@templates/.github/workflows/ci.yaml"

  github-trivy:
    extends: github
    files:
      .github/workflows/trivy-scan.yaml:
        content: "@templates/.github/workflows/trivy-scan.yaml"

repos:
  - git: https://github.com/org/myrepo
    groups: [github-ci]
    # Effective expanded groups: [github, github-ci]
    # Gets actionlint.yaml from github + ci.yaml from github-ci
```

Multi-parent example:

```yaml
groups:
  base-labels:
    settings:
      labels:
        managed: { color: "ededed" }

  github:
    files:
      .github/actionlint.yaml:
        content: "@templates/.github/actionlint.yaml"

  github-ci:
    extends: [github, base-labels]
    files:
      .github/workflows/ci.yaml:
        content: "@templates/.github/workflows/ci.yaml"
```

### Type Definitions

```typescript
export interface RawGroupConfig {
  extends?: string | string[];  // NEW: parent group name(s)
  files?: Record<string, RawFileConfig | RawRepoFileOverride | false> & {
    inherit?: boolean;
  };
  prOptions?: PRMergeOptions;
  settings?: RawRepoSettings;
}
```

The `extends` field accepts a single group name or an array of group names, consistent with the `git` field pattern on `RawRepoConfig`.

### Resolution Pipeline

The existing 4-phase pipeline gains a new Phase 0:

```text
Phase 0: Resolve extends chains (NEW)
  For each group name in the repo's groups array:
    - Recursively expand its extends chain (depth-first, parents before child)
    - Deduplicate: first occurrence wins (preserves topological order)
  Result: expanded group name list replaces the original groups array

Phase 1: Resolve explicit groups (existing, unchanged)
  root files/prOptions/settings -> merge each expanded group L->R

Phase 2: Determine effective group set (existing, now uses expanded list)
  Collect the expanded group names (explicit + transitive parents)

Phase 3: Evaluate and merge conditional groups (existing, unchanged)
  when clauses evaluate against the expanded effective group set

Phase 4: Apply repo overrides (existing, unchanged)
```

### Extends Resolution Algorithm

Both `resolveExtendsChain` and `expandRepoGroups` live in a shared `src/config/extends-resolver.ts` module, imported by both the normalizer and validator. This avoids duplicating the resolution logic (Dependency Inversion — both depend on a shared abstraction rather than each reimplementing the same algorithm).

The `resolveExtendsChain` function expands a single group name into its full ordered chain:

```text
function resolveExtendsChain(groupName, groupDefs, visited = Set(), depth = 0):
  if depth > MAX_EXTENDS_DEPTH:
    error: exceeds maximum depth
  if groupName in visited:
    error: circular extends detected
  visited.add(groupName)

  group = groupDefs[groupName]
  if !group:
    error: group does not exist
  if !group.extends:
    return [groupName]

  parents = normalize(group.extends)  // string -> [string]
  result = []
  for parent in parents:
    chain = resolveExtendsChain(parent, groupDefs, copy(visited))
    for name in chain:
      if name not in result:
        result.push(name)

  result.push(groupName)
  return result
```

The `expandRepoGroups` function expands a repo's full group list:

```text
function expandRepoGroups(repoGroups, groupDefs):
  result = []
  for groupName in repoGroups:
    chain = resolveExtendsChain(groupName, groupDefs, Set())
    for name in chain:
      if name not in result:
        result.push(name)
  return result
```

**Key properties:**
- Parents always appear before children (topological order).
- First occurrence wins for deduplication. If `github-ci extends github` and `github-trivy extends github`, a repo with `groups: [github-ci, github-trivy]` expands to `[github, github-ci, github-trivy]` (github appears once, before both children).
- The expanded list feeds directly into the existing `mergeGroupFiles`/`mergeGroupPROptions`/`mergeGroupSettings` functions, which already accept an ordered group name list.

### Merge Semantics

No changes to merge semantics. The `extends` feature only affects which groups are in the list and in what order. All existing merge behaviors apply:

- `inherit: false` on a child group's files discards all accumulated files (root and ancestor groups).
- `file: false` on a child removes a specific file introduced by a parent.
- Later groups in the expanded list override earlier ones (child overrides parent).
- PR options and settings merge identically to today.

### Effective Group Set for Conditional Groups

The effective group set (Phase 2) includes all groups from the expanded list. This means:

```yaml
conditionalGroups:
  - when:
      anyOf: [github]
    files:
      .github/settings.yml:
        content: "..."

repos:
  - git: https://github.com/org/myrepo
    groups: [github-ci]  # github-ci extends github
    # Expanded groups: [github, github-ci]
    # Effective group set: {github, github-ci}
    # Conditional group with anyOf: [github] MATCHES
```

This aligns with the design note in the #651 spec and the comment on #649.

### Validation

Added to the existing validator:

1. **`extends` field type:**
   - Must be a string or a non-empty array of strings when present.
   - Each referenced group name must exist in the `groups` map (hard error).
   - A group cannot extend itself (direct self-reference is a validation error).

2. **Cycle detection:**
   - Circular extends chains are detected and reported as validation errors.
   - Error message includes the cycle path for debuggability: `"circular extends: github-ci -> github -> github-ci"`.

3. **Reserved group name:**
   - `extends` is added as a reserved group name alongside `inherit`. A group named `extends` is rejected during validation. While technically it wouldn't collide (it's a field on group config, not a key in the groups map), allowing it would be confusing and error-prone.

4. **Per-repo group validation (existing, unchanged):**
   - Repos still reference group names that must exist in the groups map.
   - Duplicate detection in repo `groups` arrays remains unchanged (operates on the raw list, not the expanded list).

5. **`knownFiles` and `rootCtx` expansion:**
   - `validateRepoFiles` must include files from transitive parent groups in `knownFiles`, not just the repo's explicit groups. The validator expands the repo's groups using the same extends resolution to build the complete known file set.
   - Similarly, `validateRepoSettingsEntry` must include settings from transitive parent groups in `rootCtx`.

### File Reference Resolution

The existing `resolveFileReferencesInConfig` processes all groups' file entries. No change needed — parent groups are already iterated because they exist in the top-level `groups` map. The `extends` field is metadata, not content; it doesn't need file reference resolution.

### Testing Strategy

**Extends resolution:**
- Single parent: `github-ci extends github` -> expanded `[github, github-ci]`.
- Multi-parent: `github-ci extends [github, base-labels]` -> expanded `[github, base-labels, github-ci]`.
- Transitive: `c extends b`, `b extends a` -> expanded `[a, b, c]`.
- Diamond: `d extends [b, c]`, `b extends a`, `c extends a` -> expanded `[a, b, c, d]` (a appears once).
- No extends: group without extends -> just `[groupName]`.
- Mixed: repo with `groups: [github-ci, standalone]` where only `github-ci` has extends -> `[github, github-ci, standalone]`.

**Merge pipeline:**
- Parent files appear in child's effective files.
- Child `inherit: false` discards parent files.
- Child `file: false` removes specific parent file.
- Child overrides parent file content.
- Parent PR options merge into child.
- Parent settings merge into child.

**Effective group set for conditional groups:**
- Conditional group with `anyOf: [parent]` matches repo with only child group listed.
- Conditional group with `allOf: [parent, child]` matches.

**Validation:**
- `extends` with non-existent group: error.
- `extends` with self-reference: error.
- Circular extends chain (a -> b -> a): error with cycle path.
- `extends` as empty array: error.
- `extends` as non-string/non-array: error.
- Valid extends: passes.
- Known files expanded for transitive parents.
- Root context expanded for transitive parents.

**Backward compatibility:**
- Config without any `extends` fields: behavior unchanged.
- Existing tests pass without modification.

### Documentation

Update `docs/configuration/groups.md` with:
- Update "Group Fields" table to include `extends`.
- Update existing "Merge Chain" section to mention extends expansion.
- New "Group Inheritance" section explaining the `extends` field.
- Single and multi-parent examples.
- Transitive inheritance explanation.
- Interaction with conditional groups (expanded effective group set).
- Restrictions (circular chains, self-reference, reserved name).

Update `docs/configuration/inheritance.md`:
- Update line 3 to mention extends expansion in the group chain description.

Update `docs/index.md`:
- Add "Resolve group extends" step to both Mermaid pipeline diagrams (between "Expand git arrays" and "Merge group layers").

### Config Schema Updates

Update `config-schema.json`:
- Add `extends` property as first property in `definitions.groupConfig.properties` with `oneOf: [string, string[]]`.

Update `docs/reference/config-schema.md`:
- Add `extends` row to the Group Config table.
- Update context text (line 78) to mention `extends`.
