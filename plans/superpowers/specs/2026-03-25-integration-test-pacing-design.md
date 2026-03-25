# Integration Test Request Pacing

**Issue:** [#647](https://github.com/anthony-spruyt/xfg/issues/647)
**Date:** 2026-03-25

## Problem

Integration tests blast the GitHub API with no throttling. Eight GitHub test jobs run in parallel on separate CI runners, all sharing the same PAT. This triggers GitHub's secondary rate limits (403/429), causing test failures. The current `withTestRetry()` only retries on 5xx errors — it doesn't detect or handle rate limits.

GitHub's secondary limits:
- No more than 100 concurrent requests
- No more than 900 points/minute (mutating requests cost 5 points each)
- No more than 80 content-generating requests/minute
- No more than 500 content-generating requests/hour

## Solution

Four-layer defense: CI-level serialization, wave-based job ordering, per-process pacing, and reactive rate limit retry.

### Layer 1: CI-Level Concurrency Group

Add a global concurrency group to `_integration-tests.yaml` so only one workflow run runs integration tests at a time. Additional runs queue (no cancellation — cancelling mid-run orphans ephemeral repos and denies the cancelled PR its test results).

```yaml
concurrency:
  group: integration-tests
  cancel-in-progress: false
```

### Layer 2: Wave-Based Job Ordering

Group GitHub-token jobs into waves using `needs` dependencies. At most ~3 GitHub jobs share the PAT simultaneously within a single CI run.

| Wave | Jobs (workflow job IDs) | Max concurrent |
| ---- | ------------------------ | -------------- |
| 1 | `integration-test-cli-sync-github-pat`, `integration-test-cli-sync-github-app`, `integration-test-cli-sync-labels-pat` | 3 |
| 2 (needs wave 1) | `integration-test-cli-sync-rulesets-pat`, `integration-test-cli-sync-repo-settings-pat`, `integration-test-cli-lifecycle-github-pat` | 3 |
| 3 (needs wave 2) | `integration-test-cli-lifecycle-github-app`, `integration-test-action-sync-pat`, `integration-test-action-sync-app` | 3 |
| 4 (needs wave 3) | `integration-test-action-sync-settings-app`, `integration-test-action-lifecycle-pat`, `integration-test-action-lifecycle-app` | 3 |

ADO and GitLab jobs remain independent — different tokens, no GitHub API contention.

### Layer 3: Per-Process Pacing

Add `bottleneck` as a dev dependency. Convert the synchronous test helpers to async and wrap command execution through a shared `bottleneck` limiter.

**Async conversion:** All test helper functions that call the test `exec()` helper become async:
`withTestRetry`, `execWithRetry`, `waitForPrVisible`, `waitForFileVisible`,
`waitForRulesetVisible`, `waitForFileDeleted`, `waitForCommitVerified`,
`resetTestRepo`, `createRepo`, `waitForRepoReady`, `deleteRepo`,
`listRulesets`, `listLabels`, `repoExists`, `isForkedFrom`.
Functions that don't call the test `exec()` helper stay synchronous: `generateRepoName`, `writeConfig`.
All test files update call sites to use `async`/`await`.
Node's built-in test runner supports async test functions natively.

**Implementation:**
- Replace synchronous command execution with async (promisified `child_process.execFile` with shell option, from `node:child_process` + `node:util.promisify`)
- Create a shared `Bottleneck` instance in `test-helpers.ts`
- The limiter wraps the low-level `exec()` function itself, so all outbound commands — including those from `listRulesets`, `listLabels`, `repoExists`, `isForkedFrom`, and `resetTestRepo` — are paced automatically
- `resetTestRepo` makes many sequential API calls (close PRs, delete branches, delete files, delete rulesets, delete labels). With 2s min spacing this will take minutes per reset. This is acceptable — repo reset runs once per test suite in `before`/`after` hooks, not in hot paths. Reliability is more important than speed here.
- Replace `Atomics.wait` in `withTestRetry` with async `setTimeout`-based delay (e.g., `await new Promise(resolve => setTimeout(resolve, ms))`)
- Note: all command arguments in test helpers are constructed from controlled test constants (repo names from `generateRepoName`, hardcoded field names), not from external input
- `bottleneck` must be ESM-compatible (the test helpers use `import.meta.url`). Bottleneck v2 ships ESM-compatible builds.

**Limiter settings:**
- `maxConcurrent: 2` — at most 2 commands in-flight per process
- `minTime: 2000` — minimum 2 seconds between request starts (~30 req/min per job)

With 3 jobs per wave x 30 req/min = ~90 aggregate req/min. Even if all are mutations (5 points each = 450 points/min), this stays under the 900 points/min limit with 50% headroom.

### Layer 4: Reactive Rate Limit Retry

Extend `withTestRetry` and `execWithRetry` to detect and handle rate limit responses.

**Detection** — add rate limit patterns to `TRANSIENT_ERROR_PATTERNS`:
- `/rate limit/i`
- `/secondary rate/i`
- `/abuse detection/i`
- `/retry-after/i`
- `/429/`
- `/403.*rate/i`

**Retry-After honoring:**
1. On rate limit error, parse `retry-after` value from the error's stderr/stdout (the `gh` CLI includes GitHub's response headers in error output)
2. If found, wait that many seconds before retrying
3. If not found, fall back to 60 seconds
4. Use the Retry-After / fallback delay instead of exponential backoff for rate limit errors — exponential backoff burns through retries too fast on rate limits

**Retry budget:** Keep existing 6 retries with exponential backoff for transient 5xx errors. Rate limit errors use the same retry count but with Retry-After-based delays.

## Files Changed

| File | Change |
| ---- | ------ |
| `package.json` | Add `bottleneck` as devDependency |
| `test/integration/test-helpers.ts` | Convert to async; add `bottleneck` pacer; add rate limit detection + Retry-After parsing to retry logic |
| `test/integration/github.test.ts` | async/await all helper calls |
| `test/integration/github-app.test.ts` | async/await all helper calls |
| `test/integration/github-rulesets.test.ts` | async/await all helper calls |
| `test/integration/github-repo-settings.test.ts` | async/await all helper calls |
| `test/integration/github-labels.test.ts` | async/await all helper calls |
| `test/integration/github-lifecycle.test.ts` | async/await all helper calls |
| `test/integration/github-lifecycle-app.test.ts` | async/await all helper calls |
| `test/integration/ado.test.ts` | async/await all helper calls |
| `test/integration/gitlab.test.ts` | async/await all helper calls |
| `.github/workflows/_integration-tests.yaml` | Add global concurrency group; add wave `needs` dependencies |

## What Doesn't Change

- Production code (`src/`) — untouched
- Unit tests (`test/unit/`) — untouched
- ADO/GitLab CI job concurrency — independent tokens, no wave grouping needed (but test files still get async conversion for consistency)

## Rate Budget Analysis

**Worst case per wave (3 jobs, all mutations):**
- 3 jobs x 30 req/min = 90 req/min aggregate
- 90 x 5 points = 450 points/min (limit: 900) — 50% headroom
- Content-generating: 90 req/min (limit: 80) — slightly over, but not all requests are content-generating; the Retry-After safety net handles edge cases

**With reactive retry:** Even if a burst briefly exceeds secondary limits, the rate limit response includes `Retry-After` and the test backs off automatically instead of failing.
