# Recursive Subdirectory Scanning for Multi-File Config

**Issue:** #674 **Depends on:** #671 (directory-based multi-file config, already implemented) **Date:** 2026-05-18

## Problem

Directory mode (`--config <dir>`) only scans flat `.yaml`/`.yml` files in the specified directory. Users with large configs want to organize fragments into subdirectories (e.g., `teams/`, `infra/`) but these are silently ignored.

## Solution

Make `loadRawConfigFromDirectory` scan recursively. No new flags, no schema changes, no merger changes.

## Design Decisions

| Decision            | Choice                              | Rationale                                                 |
| ------------------- | ----------------------------------- | --------------------------------------------------------- |
| Opt-in vs default   | Always recursive                    | No breaking change — subdirs were silently ignored before |
| Traversal order     | Depth-first, alphabetical per level | Predictable, matches `ls -R` mental model                 |
| Max depth           | 10 levels                           | Safety net against runaway recursion                      |
| Symlinked dirs      | Skip                                | Avoid loops                                               |
| Symlinked files     | Follow                              | Users may symlink shared fragments                        |
| Fragment fileName   | Relative path from config root      | Clear provenance in error messages                        |
| Hidden files/dirs   | Skip (names starting with `.`)      | Avoid picking up `.git`, `.DS_Store`, editor temp files   |
| File ref resolution | Relative to fragment's own dir      | Users co-locate referenced files next to their fragments  |
| Unreadable subdir   | Fail entire load                    | Consistent with current behavior for unreadable root dir  |
| Windows             | Not supported                       | xfg does not support Windows                              |

## Ordering Specification

At each directory level:

1. Collect non-hidden `.yaml`/`.yml` files, sort alphabetically
1. Collect non-hidden, non-symlinked subdirectories, sort alphabetically
1. Add files to result list
1. Recurse into each subdirectory in order

Files at a given level always appear before files from subdirectories of that level. Subdirectories are processed in alphabetical order, and the same rule applies recursively within each subdirectory.

Example:

```text
xfg-config/
  base.yaml           ← 1st  (root files first, alphabetical)
  shared.yaml          ← 2nd
  infra/
    shared.yaml        ← 3rd  (infra/ before teams/ alphabetically)
  teams/
    alpha.yaml         ← 4th  (teams/ files before teams/beta/ subdir)
    beta.yaml          ← 5th
    beta/
      overrides.yaml   ← 6th
```

## Affected Code

### Changed

- `src/config/loader.ts` — `loadRawConfigFromDirectory` gains recursive traversal via a helper function that walks the directory tree

### Unchanged

- `ConfigFragment` interface — `fileName` field already accepts any string; now holds relative paths like `teams/alpha.yaml`
- `mergeConfigFragments` — already works with any `fileName` string for error messages
- Schema, normalizer, validator — no structural changes
- Single-file config loading path — untouched

## File Reference Resolution

File references (e.g., `!file ./template.json`) in fragments resolve relative to the fragment's own directory, not the config root. This is the existing behavior from `resolveFileReferencesInConfig` which receives `dirname(filePath)` as `configDir`. No change needed — this naturally works correctly for nested fragments since each fragment's absolute path is known.

Example: a `!file ./shared.json` reference in `teams/alpha.yaml` resolves to `teams/shared.json`.

## Implementation Detail

New private helper in `loader.ts`:

```typescript
function collectYamlFiles(
  rootDir: string,
  currentDir: string,
  depth: number
): Array<{ relativePath: string; absolutePath: string }>
```

- `rootDir`: the original config directory (for computing relative paths via `path.relative`)
- `currentDir`: the directory being scanned at this recursion level
- `depth`: current depth (0 at root, error if > 10)
- Returns files in depth-first alphabetical order per the ordering specification
- Skips hidden entries (names starting with `.`)
- Skips symlinked directories, follows symlinked files
- Uses `readdirSync` with `withFileTypes: true`
- Uses `entry.isSymbolicLink()` to detect symlinked directories (requires `lstat` behavior from `withFileTypes`)

`loadRawConfigFromDirectory` calls `collectYamlFiles` then iterates over the result to build `ConfigFragment[]` using the relative path as `fileName`.

## Error Cases

| Condition                               | Behavior                                                                                     |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| Depth exceeds 10                        | `ValidationError`: "Config directory nesting exceeds maximum depth of 10 at `<path>`"        |
| No YAML files found (at any depth)      | Existing error: "No .yaml or .yml files found in directory: `<path>`"                        |
| Unreadable subdirectory                 | `ValidationError`: "Failed to read config directory `<path>`: `<error>`" — fails entire load |
| Duplicate group names across files      | Existing merger error, now with relative paths for clarity                                   |
| Duplicate single-file keys across files | Existing merger error, now with relative paths for clarity                                   |

## Testing

### Unit Tests (loader.test.ts)

- Recursive discovery: nested dirs produce correct file list in correct order
- Depth-first alphabetical ordering verified against spec example
- Max depth exceeded: throws `ValidationError`
- Empty subdirectories: skipped, no error
- Subdirectory with no YAML files: skipped, no error
- Mixed: some dirs have YAML, some don't
- Symlinked directory: skipped
- Hidden files and directories: skipped
- Relative path in fragment fileName: verified in error messages via config-merger integration
- File reference resolution: resolves relative to fragment directory, not config root

### Unit Tests (config-merger.test.ts)

- Existing tests still pass (fileName format is just a string)
- Fragment with path-style fileName (e.g., `teams/alpha.yaml`) produces correct error messages
