# Rename "protect" to "settings" Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rename the `xfg protect` command to `xfg settings` to better reflect its purpose and future scope.

**Architecture:** Simple rename refactor across source, tests, CI, and docs. The command manages GitHub Rulesets via the `settings.rulesets` config block, and will expand to handle other settings (features, mergeOptions, security) in future phases.

**Tech Stack:** TypeScript, Node.js test runner, GitHub Actions

**Issue:** #297

---

## Task 1: Rename source code identifiers

**Files:**

- Modify: `src/index.ts`
- Modify: `src/cli.ts`

**Step 1: Update src/index.ts type and function names**

Replace at line 100:

```typescript
type SettingsOptions = SharedOptions;
```

Replace comment at line 278-280:

```typescript
// =============================================================================
// Settings Command
// =============================================================================
```

Replace function name at line 282:

```typescript
export async function runSettings(
  options: SettingsOptions,
```

Replace comment at line 356:

```typescript
// Note: For settings command, we don't clone repos - we work with the API directly.
```

Replace command definition at lines 473-484:

```typescript
// Settings command (ruleset management)
const settingsCommand = new Command("settings")
  .description("Manage GitHub Rulesets for repositories")
  .action((opts) => {
    runSettings(opts as SettingsOptions).catch((error) => {
      console.error("Fatal error:", error);
      process.exit(1);
    });
  });

addSharedOptions(settingsCommand);
program.addCommand(settingsCommand);
```

**Step 2: Update src/cli.ts subcommands array**

Replace line 8:

```typescript
const subcommands = ["sync", "settings", "help"];
```

**Step 3: Build and verify compilation**

Run: `npm run build`
Expected: No TypeScript errors

**Step 4: Commit**

```bash
git add src/index.ts src/cli.ts
git commit -m "refactor: rename protect command to settings in source

Refs #297"
```

---

## Task 2: Update unit tests

**Files:**

- Modify: `src/index.test.ts`

**Step 1: Update imports and test descriptions**

Find and replace all occurrences:

- `"protect command CLI"` → `"settings command CLI"`
- `"protect --help"` → `"settings --help"`
- `runProtect` → `runSettings`
- `ProtectOptions` → `SettingsOptions`
- `"runProtect with mock processor"` → `"runSettings with mock processor"`
- Test descriptions mentioning "protect" → "settings"

Key locations:

- Lines 1058-1151: Describe block and tests
- Lines 1157-1408: runSettings test suite

**Step 2: Run unit tests**

Run: `npm test`
Expected: All tests pass

**Step 3: Commit**

```bash
git add src/index.test.ts
git commit -m "test: update unit tests for settings command rename

Refs #297"
```

---

## Task 3: Rename integration test files

**Files:**

- Rename: `test/integration/github-protect.test.ts` → `test/integration/github-settings.test.ts`
- Rename: `fixtures/integration-test-config-github-protect.yaml` → `fixtures/integration-test-config-github-settings.yaml`

**Step 1: Rename files**

```bash
git mv test/integration/github-protect.test.ts test/integration/github-settings.test.ts
git mv fixtures/integration-test-config-github-protect.yaml fixtures/integration-test-config-github-settings.yaml
```

**Step 2: Update integration test content**

In `test/integration/github-settings.test.ts`:

- Update describe block: `"GitHub Settings Integration Test"`
- Update test names: `"settings creates a ruleset"`, etc.
- Update command: `"node dist/cli.js settings --config ${configPath}"`
- Update config path reference to new filename

**Step 3: Update fixture file content**

In `fixtures/integration-test-config-github-settings.yaml`:

- Update comment: `# Integration test config for xfg settings`
- Update id: `id: integration-test-github-settings`
- Update placeholder: `.xfg-settings-test:`

**Step 4: Commit**

```bash
git add test/integration/ fixtures/
git commit -m "test: rename protect integration tests to settings

Refs #297"
```

---

## Task 4: Update package.json script

**Files:**

- Modify: `package.json`

**Step 1: Rename test script**

Replace line 35:

```json
    "test:integration:github-settings": "npm run build && node --import tsx --test test/integration/github-settings.test.ts",
```

**Step 2: Commit**

```bash
git add package.json
git commit -m "build: rename integration test script for settings

Refs #297"
```

---

## Task 5: Update action.yml

**Files:**

- Modify: `action.yml`

**Step 1: Update command input description**

Replace line 11:

```yaml
description: "Command to run (sync or settings)"
```

**Step 2: Commit**

```bash
git add action.yml
git commit -m "feat(action): rename protect to settings in command input

Refs #297"
```

---

## Task 6: Update CI workflow

**Files:**

- Modify: `.github/workflows/ci.yaml`

**Step 1: Rename job and references**

Replace line 210:

```yaml
integration-test-github-settings:
```

Replace line 218:

```yaml
group: integration-github-settings
```

Replace line 247:

```yaml
- name: Run GitHub settings integration tests
```

Replace line 250:

```yaml
run: npm run test:integration:github-settings
```

Replace lines 423-428:

```yaml
# ========== Settings Test ==========
- name: "[Settings] Run xfg action with settings command"
  uses: ./
  with:
    command: settings
    config: ./fixtures/integration-test-config-github-settings.yaml
```

Replace lines 432-433:

```yaml
- name: "[Settings] Validate - verify ruleset was created"
```

Replace lines 443-444:

```yaml
- name: "[Settings] Cleanup - delete test ruleset"
```

Replace line 462 in summary job needs:

```yaml
- "integration-test-github-settings"
```

**Step 2: Commit**

```bash
git add .github/workflows/ci.yaml
git commit -m "ci: rename protect job to settings in workflow

Refs #297"
```

---

## Task 7: Update documentation

**Files:**

- Modify: `docs/index.md`
- Modify: `docs/usage/index.md`
- Modify: `docs/reference/cli-options.md`
- Modify: `docs/platforms/github.md`
- Modify: `docs/configuration/rulesets.md`
- Modify: `docs/use-cases.md`
- Modify: `docs/ci-cd/github-actions.md`

**Step 1: Update all documentation files**

Global replacements in all docs:

- `xfg protect` → `xfg settings`
- `protect command` → `settings command`
- `"protect"` → `"settings"` (in code blocks)
- `sync or protect` → `sync or settings`

Key files and locations:

- `docs/index.md`: Lines 8, 52, 74
- `docs/usage/index.md`: Lines 10, 21, 25, 28, 41-48, 75
- `docs/reference/cli-options.md`: Lines 3, 10, 63, 66-90 (entire "Protect Options" → "Settings Options")
- `docs/platforms/github.md`: Lines 139, 157
- `docs/configuration/rulesets.md`: Lines 3, 6, 41, 270, 278, 296-308
- `docs/use-cases.md`: Lines 123, 172
- `docs/ci-cd/github-actions.md`: Lines 20, 75-85

**Step 2: Commit**

```bash
git add docs/
git commit -m "docs: update documentation for settings command rename

Refs #297"
```

---

## Task 8: Final verification

**Step 1: Search for remaining "protect" references**

```bash
grep -ri "protect" --include="*.ts" --include="*.yaml" --include="*.yml" --include="*.md" --include="*.json" . | grep -v node_modules | grep -v dist | grep -v coverage | grep -v ".git" | grep -v "branch.protection" | grep -v "push-protection"
```

Expected: Only legitimate references (e.g., "branch protection" in context, push-protection.json ruleset file)

**Step 2: Run full test suite**

```bash
npm test
```

Expected: All unit tests pass

**Step 3: Build verification**

```bash
npm run build
```

Expected: Clean build

**Step 4: Run lint**

```bash
./lint.sh
```

Expected: No lint errors

**Step 5: Test CLI help**

```bash
node dist/cli.js --help
node dist/cli.js settings --help
```

Expected: Shows "settings" command, not "protect"

---

## Verification Checklist

- [ ] `npm run build` succeeds
- [ ] `npm test` passes all unit tests
- [ ] `./lint.sh` passes
- [ ] `xfg --help` shows "settings" command
- [ ] `xfg settings --help` works
- [ ] No "protect" references remain (except legitimate ones like "branch protection")
- [ ] Documentation is consistent
