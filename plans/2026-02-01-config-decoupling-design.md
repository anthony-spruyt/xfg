# Config Decoupling & Documentation Alignment

**Date:** 2026-02-01
**Status:** Draft

## Overview

Decouple `files` and `settings` validation to allow:

- Settings-only configs (for repo management without file sync)
- Files-only configs (current behavior, file sync without settings)
- Both together (full repository-as-code)

Also align all documentation to new messaging: "repository-as-code".

## Goals

1. **Decouple commands** - Allow `files` to be optional when only using `settings`, and vice versa
2. **Align messaging** - Update README, CLAUDE.md, package.json, docs/index.md to consistent "repository-as-code" messaging

## Validation Architecture

### Current State

Single `validateRawConfig()` function validates everything upfront in `config-validator.ts`. Requires `files` to exist and be non-empty.

### New State

Split into layers:

```
validateBaseConfig()     -> id, repos (always required), at least one of files/settings
validateFilesConfig()    -> files structure (when files present)
validateSettingsConfig() -> settings structure (when settings present)
validateForSync()        -> files required + non-empty
validateForSettings()    -> settings at root OR in repos, with actionable config
```

### Call Sites

| Location        | Validates                                         |
| --------------- | ------------------------------------------------- |
| `loadConfig()`  | Base + Files (if present) + Settings (if present) |
| `runSync()`     | `validateForSync()` before processing             |
| `runSettings()` | `validateForSettings()` before processing         |

### Validation Rules

**Base config (always):**

- `id` required
- `repos` required and non-empty
- Must have `files` OR `settings` (at least one)

**Command-specific:**

- `xfg sync` -> requires `files` with at least one entry + `repos`
- `xfg settings` -> requires `settings` at root OR in repos + `repos`

### Settings Validation (Future-Proof)

```typescript
function hasActionableSettings(settings: RepoSettings): boolean {
  // Extensible - add new checks as features are added
  if (settings.rulesets && Object.keys(settings.rulesets).length > 0) {
    return true;
  }
  // Future: if (settings.repoConfig) return true;
  // Future: if (settings.creation) return true;
  return false;
}
```

### Error Messages

Helpful errors that suggest alternatives:

```
# Missing both files and settings
"Config requires at least one of: 'files' or 'settings'.
Use 'files' to sync configuration files, or 'settings' to manage repository settings."

# sync with no files
"The 'sync' command requires a 'files' section with at least one file defined.
To manage repository settings instead, use 'xfg settings'."

# settings with no settings defined
"The 'settings' command requires a 'settings' section at root level or
in at least one repo. To sync files instead, use 'xfg sync'."

# settings defined but nothing actionable
"No actionable settings configured. Currently supported: rulesets.
To sync files instead, use 'xfg sync'.
See docs: https://anthony-spruyt.github.io/xfg/settings"
```

## Valid Config Examples

### Settings-only

```yaml
id: branch-protection
settings:
  rulesets:
    main-protection:
      target: branch
      enforcement: active
      conditions:
        refName:
          include: [refs/heads/main]
      rules:
        - type: pull_request
repos:
  - git: git@github.com:org/repo.git
```

### Files-only

```yaml
id: prettier-sync
files:
  .prettierrc.json:
    content:
      semi: false
      singleQuote: true
repos:
  - git: git@github.com:org/repo.git
```

### Both

```yaml
id: full-governance
files:
  .prettierrc.json:
    content:
      semi: false
settings:
  rulesets:
    main-protection: { ... }
repos:
  - git: git@github.com:org/repo.git
```

## Documentation Alignment

### Target Messaging

> "A CLI tool for repository-as-code. Sync files and manage settings across GitHub, Azure DevOps, and GitLab."

### Files to Update

| File            | New description                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------- |
| `docs/index.md` | "A CLI tool for repository-as-code. Sync files and manage settings across GitHub, Azure DevOps, and GitLab."          |
| `README.md`     | Same + add settings to example + show both commands                                                                   |
| `CLAUDE.md`     | "TypeScript CLI tool for repository-as-code: sync files and manage settings across GitHub, Azure DevOps, and GitLab." |
| `package.json`  | "CLI tool for repository-as-code"                                                                                     |
| CLI `--help`    | "Sync files and manage settings across repositories"                                                                  |

## Implementation Plan

### Track 1: Validation Decoupling

| Order | File                           | Changes                                                                                                  |
| ----- | ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| 1     | `src/config-validator.ts`      | Split `validateRawConfig()` into base + files + settings validators; remove hard requirement for `files` |
| 2     | `src/config.ts`                | Update `RawConfig` type to make `files` optional (`files?: Record<...>`)                                 |
| 3     | `src/index.ts`                 | Add `validateForSync()` call in `runSync()`, add `validateForSettings()` call in `runSettings()`         |
| 4     | `src/config-validator.test.ts` | Add tests for new validation scenarios                                                                   |
| 5     | `src/index.test.ts`            | Add tests for command-specific validation errors                                                         |

### Track 2: Documentation Alignment

| Order | File            | Changes                                                     |
| ----- | --------------- | ----------------------------------------------------------- |
| 1     | `docs/index.md` | Update tagline to new messaging                             |
| 2     | `README.md`     | Update tagline, add settings to example, show both commands |
| 3     | `CLAUDE.md`     | Update Overview line                                        |
| 4     | `package.json`  | Update description field                                    |
| 5     | `src/index.ts`  | Update CLI `program.description()`                          |

## Testing Requirements

**Coverage target:** 95%+ (codecov requirement)

### New Test Cases

| Validator                  | Test Cases                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `validateBaseConfig()`     | Missing `id`, missing `repos`, empty `repos`, valid minimal                                                              |
| `validateFilesConfig()`    | All existing file validation tests (moved)                                                                               |
| `validateSettingsConfig()` | All existing settings validation tests (moved)                                                                           |
| Base "at least one"        | No `files` AND no `settings` -> error; `files` only -> pass; `settings` only -> pass; both -> pass                       |
| `validateForSync()`        | No `files` -> helpful error; empty `files` -> error; valid -> pass                                                       |
| `validateForSettings()`    | No `settings` anywhere -> helpful error; root only -> pass; repo only -> pass; both -> pass; settings but empty -> error |
| `hasActionableSettings()`  | Empty settings -> false; has rulesets -> true                                                                            |

### Error Message Tests

- Verify error messages include command suggestions
- Verify docs URL is included where relevant

## Notes

- Integration tests use full configs with both sections - no changes needed
- Settings-only integration test config to be added in separate PR
- GitHub repo description requires manual update
