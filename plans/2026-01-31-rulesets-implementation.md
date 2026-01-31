# Rulesets Implementation Plan

> **For Claude:** Use superpowers:executing-plans to implement task-by-task.

**Goal:** Add `xfg protect` subcommand to manage GitHub Rulesets declaratively.

---

## Task 1: Validate Rulesets in Config Validator

**Files:** `src/config-validator.ts`, `src/config-validator.test.ts`

1. Write failing tests for ruleset validation (structure, rule types, parameters)
2. Add `validateRulesets()` function
3. Call from `validateRawConfig()` for root and per-repo settings
4. Verify tests pass
5. Commit

---

## Task 2: Deep Merge Settings in Normalizer

**Files:** `src/config-normalizer.ts`, `src/config-normalizer.test.ts`

1. Write failing tests for settings inheritance and deep merge
2. Add `mergeSettings()` helper with ruleset-aware deep merge
3. Apply in `normalizeConfig()` - repo settings merge with root
4. Verify tests pass
5. Commit

---

## Task 3: Upgrade Manifest to V3

**Files:** `src/manifest.ts`, `src/manifest.test.ts`

1. Write failing tests for V3 schema `{ files: [], rulesets: [] }`
2. Update manifest types and read/write functions
3. Add V2 → V3 migration (flat array becomes `{ files: array }`)
4. Verify tests pass
5. Commit

---

## Task 4: Add Subcommand Structure to CLI

**Files:** `src/index.ts`

1. Refactor to Commander subcommands: `sync` (default), `protect`
2. `xfg` bare = `xfg sync` for backwards compatibility
3. Share common options (`-c`, `-d`, `-w`, `-r`, `--no-delete`)
4. Verify existing behavior unchanged
5. Commit

---

## Task 5: Create GitHub Ruleset Strategy

**Files:** `src/strategies/github-ruleset-strategy.ts`, `src/strategies/github-ruleset-strategy.test.ts`

1. Write tests for CRUD operations (mock `gh api` calls)
2. Implement `GitHubRulesetStrategy`:
   - `list(repo)` → fetch all rulesets
   - `get(repo, id)` → fetch single ruleset
   - `create(repo, ruleset)` → POST
   - `update(repo, id, ruleset)` → PUT
   - `delete(repo, id)` → DELETE
3. Handle auth (PAT via `gh`, App via `GH_TOKEN`)
4. Verify tests pass
5. Commit

---

## Task 6: Create Ruleset Diff Utility

**Files:** `src/ruleset-diff.ts`, `src/ruleset-diff.test.ts`

1. Write tests for diff scenarios (new, modified, unchanged, deleted)
2. Implement `diffRulesets(current, desired)` → changes array
3. Generate human-readable diff output for dry-run
4. Verify tests pass
5. Commit

---

## Task 7: Create Ruleset Processor

**Files:** `src/ruleset-processor.ts`, `src/ruleset-processor.test.ts`

1. Write tests for processor orchestration
2. Implement `RulesetProcessor`:
   - Load config, resolve settings per repo
   - Fetch current rulesets via strategy
   - Diff and apply changes (or dry-run display)
   - Handle `deleteOrphaned`
   - Update manifest
3. Verify tests pass
4. Commit

---

## Task 8: Wire Up protect Command

**Files:** `src/index.ts`

1. Connect `protect` subcommand to `RulesetProcessor`
2. Add integration test with real repo (dry-run only)
3. Verify end-to-end flow
4. Commit

---

## Task 9: Update Config Schema

**Files:** `config-schema.json`

1. Add `settings.rulesets` schema for IDE validation
2. Include all rule types and parameters
3. Commit

---

## Task 10: Final Testing

1. Run full test suite: `npm test`
2. Run linter: `./lint.sh`
3. Manual test with real config (dry-run)
4. Commit any fixes
