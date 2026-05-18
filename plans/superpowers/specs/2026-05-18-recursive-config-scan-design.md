# Recursive Subdirectory Scanning for Multi-File Config

**Issue:** #674 **Depends on:** #671 (directory-based multi-file config, already implemented) **Date:** 2026-05-18

## Problem

Directory mode (`--config <dir>`) only scans flat `.yaml`/`.yml` files in the specified directory. Users with large configs want to organize fragments into subdirectories (e.g., `teams/`, `infra/`) but these are silently ignored.

## Solution

Make `loadRawConfigFromDirectory` scan recursively. No new flags, no schema changes, no merger changes.

## Design Decisions

| Decision          | Choice                              | Rationale                                                 |
| ----------------- | ----------------------------------- | --------------------------------------------------------- |
| Opt-in vs default | Always recursive                    | No breaking change — subdirs were silently ignored before |
| Traversal order   | Depth-first, alphabetical per level | Predictable, matches `ls -R` mental model                 |
| Max depth         | 10 levels                           | Safety net against runaway recursion                      |
| Symlinked dirs    | Skip                                | Avoid loops                                               |
| Symlinked files   | Follow                              | Users may symlink shared fragments                        |
| Fragment fileName | Relative path from config root      | Clear provenance in error messages                        |

## Ordering Specification

At each directory level:

1. Collect `.yaml`/`.yml` files, sort alphabetically
1. Collect subdirectories, sort alphabetically
1. Add files to result list
1. Recurse into each subdirectory (depth-first)

Example:

```text
xfg-config/
  base.yaml           ← 1st
  shared.yaml          ← 2nd
  infra/
    shared.yaml        ← 3rd
  teams/
    alpha.yaml         ← 4th
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

## Implementation Detail

New private helper in `loader.ts`:

```typescript
function collectYamlFiles(
  rootDir: string,
  currentDir: string,
  depth: number
): Array<{ relativePath: string; absolutePath: string }>
```

- `rootDir`: the original config directory (for computing relative paths)
- `currentDir`: the directory being scanned at this recursion level
- `depth`: current depth (0 at root, error if > 10)
- Returns files in depth-first alphabetical order
- Skips symlinked directories, follows symlinked files
- Uses `readdirSync` with `withFileTypes: true`

`loadRawConfigFromDirectory` calls `collectYamlFiles` then iterates over the result to build `ConfigFragment[]` using the relative path as `fileName`.

## Error Cases

| Condition                               | Behavior                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------- |
| Depth exceeds 10                        | `ValidationError`: "Config directory nesting exceeds maximum depth of 10 at `<path>`" |
| No YAML files found (at any depth)      | Existing error: "No .yaml or .yml files found in directory: `<path>`"                 |
| Unreadable subdirectory                 | `ValidationError`: "Failed to read config directory `<path>`: `<error>`"              |
| Duplicate group names across files      | Existing merger error, now with relative paths for clarity                            |
| Duplicate single-file keys across files | Existing merger error, now with relative paths for clarity                            |

## Testing

### Unit Tests (loader.test.ts)

- Recursive discovery: nested dirs produce correct file list in correct order
- Depth-first alphabetical ordering verified against spec example
- Max depth exceeded: throws `ValidationError`
- Empty subdirectories: skipped, no error
- Subdirectory with no YAML files: skipped, no error
- Mixed: some dirs have YAML, some don't
- Symlinked directory: skipped
- Relative path in fragment fileName: verified in error messages via config-merger integration

### Unit Tests (config-merger.test.ts)

- Existing tests still pass (fileName format is just a string)
- Fragment with path-style fileName (e.g., `teams/alpha.yaml`) produces correct error messages
