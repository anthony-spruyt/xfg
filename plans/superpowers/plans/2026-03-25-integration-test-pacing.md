# Integration Test Request Pacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add request pacing and rate limit retry to integration tests to prevent GitHub secondary rate limit failures.

**Architecture:** Four-layer defense — CI concurrency group, wave-based job ordering, per-process `bottleneck` pacing on async test helpers, and reactive Retry-After retry logic. All changes are in test infrastructure and CI config; production code is untouched.

**Tech Stack:** TypeScript, Node.js built-in test runner, `bottleneck` (dev dependency), GitHub Actions

**Spec:** `plans/superpowers/specs/2026-03-25-integration-test-pacing-design.md`

**Security note:** All shell commands in integration test helpers use controlled test constants (repo names from `generateRepoName`, hardcoded field names) — never external/user input. The `execFile` with shell option is the correct choice here since commands require shell features (pipes, env expansion). This matches the existing pattern documented in the test-helpers codebase comments.

---

## Tasks

### Task 1: Install bottleneck and verify ESM compatibility

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install bottleneck as a dev dependency**

Run: `npm install --save-dev bottleneck`

- [ ] **Step 2: Verify ESM import works**

```bash
node --input-type=module -e "import Bottleneck from 'bottleneck'; const l = new Bottleneck({ maxConcurrent: 1, minTime: 100 }); console.log('OK:', typeof l.schedule);"
```

Expected: `OK: function`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add bottleneck dev dependency for integration test pacing (#647)"
```

---

### Task 2: Convert low-level `exec()` to async with bottleneck pacing

**Files:**
- Modify: `test/integration/test-helpers.ts`

This task converts the foundation — the `exec()` function — from synchronous `execSync` to async `execFile` with a shared `Bottleneck` limiter. All other helpers call `exec()`, so this change propagates the async requirement upward.

- [ ] **Step 1: Update imports and create limiter**

At the top of `test-helpers.ts`:
- Remove the `execSync` import from `"node:child_process"`
- Add `execFile` import from `"node:child_process"`
- Add `promisify` import from `"node:util"`
- Add `Bottleneck` default import from `"bottleneck"`
- Create the promisified wrapper and limiter instance:

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Bottleneck from "bottleneck";

const execFileAsync = promisify(execFile);

const limiter = new Bottleneck({
  maxConcurrent: 2,
  minTime: 2000,
});
```

- [ ] **Step 2: Convert `exec()` to async**

Replace the existing synchronous `exec` function with an async version that wraps through the bottleneck limiter. The function uses `execFileAsync("sh", ["-c", command], ...)` to run shell commands asynchronously. Keep the same error handling pattern (log command, stderr, stdout on failure). Return type changes from `string` to `Promise<string>`.

- [ ] **Step 3: Commit**

```bash
git add test/integration/test-helpers.ts
git commit -m "refactor: convert exec() to async with bottleneck pacing (#647)"
```

---

### Task 3: Convert `withTestRetry()` to async with rate limit detection

**Files:**
- Modify: `test/integration/test-helpers.ts`

- [ ] **Step 1: Add rate limit patterns**

Add a `RATE_LIMIT_PATTERNS` array alongside the existing `TRANSIENT_ERROR_PATTERNS`. Also add rate limit patterns to `TRANSIENT_ERROR_PATTERNS` so that `execWithRetry` classifies them as transient (not permanent):

```typescript
// Add to TRANSIENT_ERROR_PATTERNS:
/rate limit/i,
/secondary rate/i,
/abuse detection/i,
/too many requests/i,
/retry-after/i,
/429/,
/403.*rate/i,

// New separate array for rate-limit-specific detection:
const RATE_LIMIT_PATTERNS = [
  /rate limit/i,
  /secondary rate/i,
  /abuse detection/i,
  /too many requests/i,
  /429/,
  /403.*rate/i,
];
```

- [ ] **Step 2: Add `parseRetryAfter` and `delay` helpers**

```typescript
function parseRetryAfter(errorText: string): number | null {
  const match = /retry-after:\s*(\d+)/i.exec(errorText);
  if (match) {
    return parseInt(match[1], 10) * 1000; // seconds → ms
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Step 3: Convert `withTestRetry()` to async**

Key changes from the synchronous version:
- Signature: `async function withTestRetry<T>(fn: () => T | Promise<T>, ...): Promise<T>`
- `return fn()` → `return await fn()`
- Replace `Atomics.wait(...)` with `await delay(waitMs)`
- On rate limit errors: parse Retry-After from error text, fall back to 60s if not found
- On non-rate-limit transient errors: keep the exponential backoff `baseDelayMs * 2 ** (attempt - 1)`
- Log differently for rate limit vs transient errors

- [ ] **Step 4: Commit**

```bash
git add test/integration/test-helpers.ts
git commit -m "feat: add rate limit detection and Retry-After to withTestRetry (#647)"
```

---

### Task 4: Convert remaining test helpers to async

**Files:**
- Modify: `test/integration/test-helpers.ts`

Convert all remaining functions that call `exec()` to async. Since `exec()` now returns `Promise<string>`, every caller must become async.

- [ ] **Step 1: Convert `execWithRetry()`**

Make it `async`, change return to `Promise<string>`, make its inner callback `async`, `await exec(...)`.

- [ ] **Step 2: Convert polling/wait helpers**

Each of these needs `async` keyword, `Promise<...>` return type, `await` on `withTestRetry(...)` and `exec(...)`:
- `waitForPrVisible`
- `waitForFileVisible`
- `waitForRulesetVisible`
- `waitForFileDeleted`
- `waitForCommitVerified`

- [ ] **Step 3: Convert data query helpers**

Each needs `async` + `await exec(...)`:
- `listRulesets` → `Promise<Array<...>>`
- `listLabels` → `Promise<Array<...>>`
- `repoExists` → `Promise<boolean>`
- `isForkedFrom` → `Promise<boolean>`

- [ ] **Step 4: Convert lifecycle helpers**

- `deleteRepo` → `async`, `await exec(...)`
- `createRepo` → `async`, `await execWithRetry(...)`, `await waitForRepoReady(...)`
- `waitForRepoReady` → `async`, `await withTestRetry(...)`, `await exec(...)`

- [ ] **Step 5: Convert `resetTestRepo()`**

Make it `async`. Every `exec(...)` call inside → `await exec(...)`. The many sequential API calls will be paced through the limiter at 2s intervals — this makes reset slower but more reliable.

- [ ] **Step 6: Commit**

```bash
git add test/integration/test-helpers.ts
git commit -m "refactor: convert all test helpers to async (#647)"
```

---

### Task 5: Convert `github.test.ts` to async

**Files:**
- Modify: `test/integration/github.test.ts`

- [ ] **Step 1: Add `await` to all helper calls**

1. `before()` callback → `async`, `await createRepo(...)`
2. `after()` callback → `async`, `await deleteRepo(...)`
3. `beforeEach()` callback → `async`, `await resetTestRepo(...)`
4. Local `waitForFileVisible` wrapper → `async`, returns `Promise<string>`
5. Every `exec(...)` in test bodies → `await exec(...)`
6. Every `waitForPrVisible(...)` → `await waitForPrVisible(...)`
7. Every `waitForFileVisible(...)` → `await waitForFileVisible(...)`

Test callbacks are already `async`.

- [ ] **Step 2: Commit**

```bash
git add test/integration/github.test.ts
git commit -m "refactor: convert github.test.ts to async/await (#647)"
```

---

### Task 6: Convert `github-app.test.ts` to async

**Files:**
- Modify: `test/integration/github-app.test.ts`

- [ ] **Step 1: Add `await` to all helper calls**

1. All `before()` callbacks → `async`, `await createRepo(...)`
2. All `after()` callbacks → `async`, `await deleteRepo(...)`
3. All `beforeEach()` callbacks → `async`, `await resetTestRepo(...)`
4. All `exec(...)` → `await exec(...)`
5. All `waitForPrVisible(...)` → `await waitForPrVisible(...)`
6. All `waitForCommitVerified(...)` → `await waitForCommitVerified(...)`
7. Non-async test callbacks (the `settings` and `repo settings` tests) → add `async`

- [ ] **Step 2: Commit**

```bash
git add test/integration/github-app.test.ts
git commit -m "refactor: convert github-app.test.ts to async/await (#647)"
```

---

### Task 7: Convert `github-rulesets.test.ts` to async

**Files:**
- Modify: `test/integration/github-rulesets.test.ts`

- [ ] **Step 1: Add `await` to all helper calls**

1. `before()` → `async`, `await createRepo(...)`
2. `after()` → `async`, `await deleteRepo(...)`
3. `beforeEach()` → `async`, `await deleteRulesetIfExists()`
4. Local `deleteRulesetIfExists()` → `async`, `await exec(...)`
5. Local `waitForRulesetVisible()` wrapper → `async`, `await waitForRulesetVisibleBase(...)`
6. All `exec(...)` → `await exec(...)`

- [ ] **Step 2: Commit**

```bash
git add test/integration/github-rulesets.test.ts
git commit -m "refactor: convert github-rulesets.test.ts to async/await (#647)"
```

---

### Task 8: Convert `github-repo-settings.test.ts` to async

**Files:**
- Modify: `test/integration/github-repo-settings.test.ts`

- [ ] **Step 1: Add `await` to all helper calls**

1. `before()` → `async`, `await createRepo(...)`
2. `after()` → `async`, `await deleteRepo(...)`
3. `beforeEach()` → `async`, `await resetRepoSettings()`, `await resetSecuritySettings()`
4. Local helpers `resetRepoSettings()`, `resetSecuritySettings()`, `getSecuritySettings()`, `getRepoSettings()` → all `async` with `await exec(...)`
5. All `exec(...)` in test bodies → `await exec(...)`
6. Non-async test callbacks → add `async`

- [ ] **Step 2: Commit**

```bash
git add test/integration/github-repo-settings.test.ts
git commit -m "refactor: convert github-repo-settings.test.ts to async/await (#647)"
```

---

### Task 9: Convert `github-labels.test.ts` to async

**Files:**
- Modify: `test/integration/github-labels.test.ts`

- [ ] **Step 1: Add `await` to all helper calls**

1. `before()` → `async`, `await createRepo(...)`
2. `after()` → `async`, `await deleteRepo(...)`
3. `beforeEach()` → `async` — the label deletion loop needs `await exec(...)`
4. Local `getLabels()` → `async`, `await exec(...)`, returns `Promise<Label[]>`
5. Local `getXfgLabels()` → `async`, `await getLabels()`, returns `Promise<Label[]>`
6. Local `runSync()` → `async`, `await exec(...)`, returns `Promise<string>`
7. `findLabel()` stays sync (pure array operation, no exec)
8. All `withTestRetry(...)` → `await withTestRetry(...)`, their callbacks → `async`
9. Non-async test callbacks → add `async`

- [ ] **Step 2: Commit**

```bash
git add test/integration/github-labels.test.ts
git commit -m "refactor: convert github-labels.test.ts to async/await (#647)"
```

---

### Task 10: Convert `github-lifecycle.test.ts` to async

**Files:**
- Modify: `test/integration/github-lifecycle.test.ts`

- [ ] **Step 1: Add `await` to all helper calls**

1. `afterEach()` → `async`, loop with `await deleteRepo(...)`
2. All `exec(...)` → `await exec(...)`
3. All `repoExists(...)` → `await repoExists(...)`
4. All `isForkedFrom(...)` → `await isForkedFrom(...)`

Test callbacks are already `async`.

- [ ] **Step 2: Commit**

```bash
git add test/integration/github-lifecycle.test.ts
git commit -m "refactor: convert github-lifecycle.test.ts to async/await (#647)"
```

---

### Task 11: Convert `github-lifecycle-app.test.ts` to async

**Files:**
- Modify: `test/integration/github-lifecycle-app.test.ts`

- [ ] **Step 1: Add `await` to all helper calls**

Same pattern as Task 10:
1. `afterEach()` → `async`, loop with `await deleteRepo(...)`
2. All `exec(...)` → `await exec(...)`
3. All `repoExists(...)` → `await repoExists(...)`
4. All `isForkedFrom(...)` → `await isForkedFrom(...)`

- [ ] **Step 2: Commit**

```bash
git add test/integration/github-lifecycle-app.test.ts
git commit -m "refactor: convert github-lifecycle-app.test.ts to async/await (#647)"
```

---

### Task 12: Convert `ado.test.ts` to async

**Files:**
- Modify: `test/integration/ado.test.ts`

- [ ] **Step 1: Add `await` to all helper calls**

1. `beforeEach()` → `async`, `await resetTestRepo()`
2. Local helpers `adoApi()`, `getFileContent()`, `getLatestCommit()`, `getDefaultBranch()`, `pushFileChange()`, `resetTestRepo()` → all `async` with `await exec(...)` (note: `adoApi` calls `exec` directly)
3. All `exec(...)` in test bodies → `await exec(...)`
4. All local helper calls in test bodies that became async → add `await`

- [ ] **Step 2: Commit**

```bash
git add test/integration/ado.test.ts
git commit -m "refactor: convert ado.test.ts to async/await (#647)"
```

---

### Task 13: Convert `gitlab.test.ts` to async

**Files:**
- Modify: `test/integration/gitlab.test.ts`

- [ ] **Step 1: Add `await` to all helper calls**

1. `beforeEach()` → `async`, `await resetTestRepo()`
2. Local helpers `glabApi()`, `getFileContent()`, `getDefaultBranch()`, `pushFileChange()`, `getMRByBranch()`, `resetTestRepo()` → all `async` with `await exec(...)` / `await glabApi(...)`
3. All local helper calls in test bodies → add `await`

- [ ] **Step 2: Commit**

```bash
git add test/integration/gitlab.test.ts
git commit -m "refactor: convert gitlab.test.ts to async/await (#647)"
```

---

### Task 14: Full type-check, lint, and unit test pass

**Files:**
- All modified files

- [ ] **Step 1: Run type check**

Run: `npm run test:typecheck`

Expected: PASS

- [ ] **Step 2: Run lint**

Run: `./lint.sh`

Expected: PASS. Fix any issues (unused `execSync` import, missing `await`, etc.)

- [ ] **Step 3: Run unit tests**

Run: `npm test`

Expected: All pass. Integration tests are not run here — they require live API credentials.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: lint and type-check fixes for async test helpers (#647)"
```

---

### Task 15: Update CI workflow with concurrency group and wave ordering

**Files:**
- Modify: `.github/workflows/_integration-tests.yaml`

- [ ] **Step 1: Add global concurrency group**

At the top level (after `permissions:`), add:

```yaml
concurrency:
  group: integration-tests
  cancel-in-progress: false
```

- [ ] **Step 2: Add wave 2 `needs`**

Add to `integration-test-cli-sync-rulesets-pat`, `integration-test-cli-sync-repo-settings-pat`, `integration-test-cli-lifecycle-github-pat`:

```yaml
needs: [integration-test-cli-sync-github-pat, integration-test-cli-sync-github-app, integration-test-cli-sync-labels-pat]
```

- [ ] **Step 3: Add wave 3 `needs`**

Add to `integration-test-cli-lifecycle-github-app`, `integration-test-action-sync-pat`, `integration-test-action-sync-app`:

```yaml
needs: [integration-test-cli-sync-rulesets-pat, integration-test-cli-sync-repo-settings-pat, integration-test-cli-lifecycle-github-pat]
```

- [ ] **Step 4: Add wave 4 `needs`**

Add to `integration-test-action-sync-settings-app`, `integration-test-action-lifecycle-pat`, `integration-test-action-lifecycle-app`:

```yaml
needs: [integration-test-cli-lifecycle-github-app, integration-test-action-sync-pat, integration-test-action-sync-app]
```

- [ ] **Step 5: Verify ADO and GitLab jobs are untouched**

`integration-test-cli-sync-ado-pat` and `integration-test-cli-sync-gitlab-pat` must have NO `needs` added. They already have their own concurrency groups.

- [ ] **Step 6: Validate YAML syntax**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/_integration-tests.yaml')); print('YAML valid')"
```

Expected: `YAML valid`

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/_integration-tests.yaml
git commit -m "ci: add concurrency group and wave-based job ordering (#647)"
```

---

### Task 16: Final verification

- [ ] **Step 1: Full type check**

Run: `npm run test:typecheck`
Expected: PASS

- [ ] **Step 2: Lint**

Run: `./lint.sh`
Expected: PASS

- [ ] **Step 3: Unit tests**

Run: `npm test`
Expected: All pass
