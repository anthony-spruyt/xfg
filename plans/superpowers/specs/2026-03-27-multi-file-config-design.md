# Multi-File Configuration Support

## Problem

As xfg configurations grow, a single YAML file becomes unwieldy. Teams managing dozens or hundreds of repos end up with massive config files that are hard to navigate, cause merge conflicts, and lack clear ownership boundaries.

## Solution

Extend the `-c, --config <path>` CLI flag to accept a directory in addition to a file. When a directory is provided, all `.yaml` and `.yml` files directly in that directory are loaded and merged into a single configuration.

## CLI Behavior

- `-c` auto-detects file vs directory via `fs.stat()`
- Trailing slash is optional: `-c ./xfg-config/` and `-c ./xfg-config` are equivalent
- File mode: unchanged, existing behavior preserved
- Directory mode: scans for `*.yaml` and `*.yml` files (flat, no recursion), sorts alphabetically by filename, merges

## Merge Rules

Files are loaded individually via existing `loadRawConfig()`, then merged by `mergeConfigFragments()`.

### Multi-file keys (can span multiple files)

| Key | Merge behavior |
| --- | --- |
| `groups` | Merge by group name key. Duplicate group names across files are an error. Group composition uses `extends`, not cross-file merging. |
| `conditionalGroups` | Array concatenation in alphabetical file order |
| `repos` | Array concatenation in alphabetical file order |

### Single-file keys (must appear in exactly one file)

| Key | Notes |
| --- | --- |
| `id` | Required -- must appear in exactly one file |
| `files` | Root-level file definitions |
| `prOptions` | Global PR options |
| `prTemplate` | PR body template |
| `settings` | Global settings (rulesets, labels, repo settings) |
| `githubHosts` | Enterprise GitHub hosts |
| `deleteOrphaned` | Global orphan deletion default |

If any single-file key appears in more than one file, it is an error.

## Directory Structure Example

```text
xfg-config/
  base.yaml          # id, files, settings, prOptions, groups (shared)
  team-alpha.yaml     # groups (alpha-owned), repos (alpha-owned)
  team-beta.yaml      # groups (beta-owned), repos (beta-owned)
  infra.yaml          # groups (infra-owned), repos (infra-owned)
```

```yaml
# base.yaml
id: my-org-config
files:
  .editorconfig:
    content: |
      root = true
      [*]
      indent_style = space

groups:
  shared-ci:
    files:
      .github/workflows/ci.yml:
        content: { ... }

settings:
  labels:
    bug: { color: "d73a4a" }

prOptions:
  merge: auto
  mergeStrategy: squash
```

```yaml
# team-alpha.yaml
groups:
  alpha-standard:
    extends: shared-ci
    files:
      .github/CODEOWNERS:
        content: "* @org/alpha"

repos:
  - git: git@github.com:org/alpha-api.git
    groups: [alpha-standard]
  - git: git@github.com:org/alpha-web.git
    groups: [alpha-standard]
```

## Loader Architecture

The change is contained to `config/loader.ts`. The existing normalization pipeline is untouched.

```text
loadConfig(path, env)
  |-- fs.stat(path)
  |-- if file -> loadRawConfig(path) [existing, unchanged]
  |-- if directory ->
  |    |-- scan for *.yaml, *.yml (flat, no recursion)
  |    |-- sort alphabetically by filename
  |    |-- loadRawConfig() each file individually
  |    |-- mergeConfigFragments(rawConfigs[])
  |    |    |-- validate single-file-only keys are not duplicated
  |    |    |-- validate group names are unique across files
  |    |    |-- concatenate conditionalGroups arrays
  |    |    |-- concatenate repos arrays
  |    |    +-- return merged RawConfig
  |    +-- return merged RawConfig
  +-- normalizeConfig(rawConfig, env) [existing, unchanged]
```

Key design decisions:

- Each file goes through `loadRawConfig()` individually, so `@path` file references resolve relative to each file's own directory.
- `mergeConfigFragments()` is a pure function: `RawConfig[] -> RawConfig` -- easy to unit test.
- Validation runs on the merged result, not per-fragment.
- The normalizer, validator, and everything downstream see a normal `RawConfig`.

## Schema Changes

The JSON schema relaxes `id` and `repos` from required to optional. The "at least one file must define `id`" and "at least one file must define `repos`" constraints are enforced in code during the merge phase, with clear error messages referencing filenames.

## Error Messages

```text
Error: 'id' is defined in both base.yaml and team-alpha.yaml --
  this key can only appear in one file

Error: group 'platform' is defined in both base.yaml and team-beta.yaml --
  group names must be unique across files

Error: 'prOptions' is defined in both base.yaml and infra.yaml --
  this key can only appear in one file

Error: no 'id' found in any file in directory ./xfg-config/

Error: no .yaml or .yml files found in directory ./xfg-config/
```

## Testing Strategy

### Unit tests for `mergeConfigFragments()`

- Two files with `repos` -- concatenated in order
- Two files with unique `groups` -- merged into single groups map
- Two files with same group name -- error
- Two files with `id` -- error
- Two files with `prOptions` -- error (same for all single-file-only keys)
- One file with `id` + `files`, another with only `repos` -- valid merge
- No files -- error
- Directory with no yaml files -- error

### Integration tests

- `loadConfig()` with directory path -- produces same `Config` as equivalent single file
- `@path` references resolve relative to each fragment file's location
- Alphabetical ordering verified (repos from `a.yaml` before `b.yaml`)
- End-to-end: directory config syncs identically to equivalent single-file config

### No changes needed to

- Normalizer tests
- Validator tests
- Repository processor tests
- CLI tests (beyond accepting directory path)

## Documentation

- `docs/` (GitHub Pages): New section on multi-file configuration with directory structure examples, merge rules table, error cases, and migration guide from single-file
- `README.md`: Brief mention that `-c` accepts a directory

## Future Work

- Recursive subdirectory scanning (to be filed as enhancement issue)
- Cross-directory imports (`imports:` directive for composability across projects)
