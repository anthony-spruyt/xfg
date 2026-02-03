# Test Directory Reorganization

## Overview

Move all test-related files under `test/` for consistent organization.

## Current State

- `fixtures/` at repo root (test configs and data)
- 33 unit test files co-located in `src/` alongside source
- `test/` contains only `integration/` and `mocks/`

## Target Structure

```
test/
  fixtures/           # moved from root
    expected/
    templates/
    *.yaml            # integration test configs
    test-fixtures.ts
  integration/        # already exists
  mocks/              # already exists
  unit/               # new - mirrors src/ structure
    strategies/       # for src/strategies/*.test.ts
    *.test.ts
```

## Files Requiring Updates

### Configuration Files

| File                        | Change                                                         |
| --------------------------- | -------------------------------------------------------------- |
| `scripts/run-tests.js`      | Glob: `src/**/*.test.ts` → `test/unit/**/*.test.ts`            |
| `package.json`              | c8 exclude: `src/**/*.test.ts` → `test/unit/**/*.test.ts`      |
| `.gitleaks.toml`            | Path: `fixtures/test-fixtures\.ts$` → `test/fixtures/...`      |
| `.mega-linter.yml`          | Path: `fixtures/templates/invalid\.json` → `test/fixtures/...` |
| `.prettierignore`           | Path: `fixtures/templates/invalid.json` → `test/fixtures/...`  |
| `.github/workflows/ci.yaml` | Paths: `./fixtures/...` → `./test/fixtures/...`                |

### Import Path Updates

All 33 unit test files need import path updates:

- Root level tests: `./foo.js` → `../../src/foo.js`
- Strategy tests: `./foo.js` → `../../../src/strategies/foo.js`

## Execution Order

1. Create directories: `test/unit/` and `test/unit/strategies/`
2. Move fixtures: `git mv fixtures/ test/fixtures/`
3. Move unit tests: `git mv src/*.test.ts test/unit/`
4. Move strategy tests: `git mv src/strategies/*.test.ts test/unit/strategies/`
5. Update 6 config files
6. Update import paths in all 33 test files
7. Verify: `npm test` and `./lint.sh`

## Risk Mitigation

- Use `git mv` to preserve history
- TypeScript catches broken imports at compile time
- Run full test suite after changes
