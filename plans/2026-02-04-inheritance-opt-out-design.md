# Inheritance Opt-Out for Files and Rulesets

## Overview

Add the ability for repos to opt out of inherited defaults at two levels:

1. **Single item opt-out**: `itemName: false` - skip one specific file or ruleset
2. **All items opt-out**: `inherit: false` - skip all inherited defaults, optionally add custom

## Syntax

```yaml
files:
  .prettierrc: { content: { ... } } # Default file

settings:
  rulesets:
    main-protection: { ... } # Default ruleset

repos:
  - git: git@github.com:org/standard.git
    # Gets all defaults (current behavior)

  - git: git@github.com:org/partial.git
    files:
      .prettierrc: false # Skip this one file
    settings:
      rulesets:
        main-protection: false # Skip this one ruleset

  - git: git@github.com:org/custom.git
    files:
      inherit: false # Skip ALL default files
      custom.json: { content: { ... } } # Add repo-specific
    settings:
      rulesets:
        inherit: false # Skip ALL default rulesets
        custom-rule: { ... } # Add repo-specific
```

## Reserved Key

`inherit` cannot be used as a filename or ruleset name at the root level.

- `inherit` not specified -> defaults to `true` (inherit all)
- `inherit: true` -> explicit, same as default (allowed)
- `inherit: false` -> skip all inherited defaults

## Type Changes

In `config.ts`:

```typescript
// Files: allow false for single opt-out, or object with optional inherit
export interface RawRepoConfig {
  git: string | string[];
  files?: Record<string, RawRepoFileOverride | false> & { inherit?: boolean };
  prOptions?: PRMergeOptions;
  settings?: RawRepoSettings;
}

// Rulesets: same pattern
export interface RawRepoSettings {
  rulesets?: Record<string, Ruleset | false> & { inherit?: boolean };
  deleteOrphaned?: boolean;
}
```

## Config Normalizer Changes

In `config-normalizer.ts`:

### For files (in `normalizeConfig`)

```typescript
// Check if repo opts out of all inherited files
const inheritFiles = rawRepo.files?.inherit !== false;

for (const fileName of fileNames) {
  // Skip reserved key
  if (fileName === "inherit") continue;

  const repoOverride = rawRepo.files?.[fileName];

  // Skip if single file opt-out
  if (repoOverride === false) continue;

  // Skip if inherit: false and no repo-specific override
  if (!inheritFiles && !repoOverride) continue;

  // ... rest of existing merge logic
}

// Add repo-specific files not in root (when inherit: false)
if (!inheritFiles && rawRepo.files) {
  for (const [fileName, override] of Object.entries(rawRepo.files)) {
    if (fileName === "inherit") continue;
    if (override === false) continue;
    if (fileNames.includes(fileName)) continue; // Already processed
    // Process repo-only file...
  }
}
```

### For rulesets (in `mergeSettings`)

Similar pattern - check `inherit` flag before merging root rulesets.

## Validation Changes

In `config-validator.ts`:

### Reserved key validation (root level)

```typescript
// In validateRootFiles()
if (files && "inherit" in files) {
  errors.push({
    path: "files.inherit",
    message: "'inherit' is a reserved key and cannot be used as a filename",
  });
}

// In validateRootSettings()
if (settings?.rulesets && "inherit" in settings.rulesets) {
  errors.push({
    path: "settings.rulesets.inherit",
    message: "'inherit' is a reserved key and cannot be used as a ruleset name",
  });
}
```

### Typo protection (repo level)

```typescript
// In validateRepoFiles()
for (const [fileName, override] of Object.entries(repo.files)) {
  if (fileName === "inherit") continue;

  if (override === false && !rootFileNames.includes(fileName)) {
    errors.push({
      path: `repos[${i}].files.${fileName}`,
      message: `Cannot opt out of '${fileName}' - not defined in root files`,
    });
  }
}

// Same pattern for rulesets
```

## JSON Schema Updates

Add `inherit` as valid boolean property in both `files` and `rulesets` objects at repo level.

## Files to Modify

| File                                  | Changes                                                                |
| ------------------------------------- | ---------------------------------------------------------------------- |
| `src/config.ts`                       | Add `inherit?: boolean` to types, allow `false` for rulesets           |
| `src/config-normalizer.ts`            | Handle `inherit: false` and single opt-out for both files and rulesets |
| `src/config-validator.ts`             | Validate reserved key, typo protection                                 |
| `src/json-schema.ts`                  | Update schema for new syntax                                           |
| `test/unit/config-normalizer.test.ts` | Add test cases                                                         |
| `test/unit/config-validator.test.ts`  | Add validation tests                                                   |
| `docs/configuration/inheritance.md`   | Document `inherit: false` pattern for files                            |
| `docs/configuration/rulesets.md`      | Document single opt-out and `inherit: false` for rulesets              |

## Implementation Order

1. Types (`config.ts`)
2. Validation (`config-validator.ts`)
3. Normalizer logic (`config-normalizer.ts`)
4. JSON schema (`json-schema.ts`)
5. Unit tests
6. Documentation

## Test Cases

### config-normalizer.test.ts

1. Single file opt-out: `files: { ".eslintrc": false }` -> file excluded from output
2. Single ruleset opt-out: `rulesets: { "main-protection": false }` -> ruleset excluded
3. All files opt-out: `files: { inherit: false }` -> no files in output
4. All rulesets opt-out: `rulesets: { inherit: false }` -> no rulesets in output
5. Inherit false + custom: `files: { inherit: false, "custom.json": {...} }` -> only custom file
6. Explicit inherit true: `files: { inherit: true }` -> same as not specifying (all files)
7. Mixed: opt out of one file, inherit others normally

### config-validator.test.ts

1. Reserved key at root: `files: { inherit: {...} }` -> error
2. Opt-out non-existent file: `files: { "typo.json": false }` -> error
3. Valid inherit false: no error
4. Valid single opt-out: no error

### Integration tests

One test per platform verifying a repo with `inherit: false` doesn't receive default rulesets.

## Not in Scope

- Settings-level `inherit: false` (just files and rulesets for now)
- Warn on redundant `itemName: false` when `inherit: false` is set
