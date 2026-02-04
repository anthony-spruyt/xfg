# Design: Fix Flaky Integration Test via Test Isolation

**Issue:** [#340](https://github.com/anthony-spruyt/xfg/issues/340)
**Date:** 2026-02-04

## Problem

The GitHub settings integration test `settings updates an existing ruleset` is flaky due to GitHub API eventual consistency. Test 2 depends on state created by Test 1, and despite PR #331's polling fix, timing windows between tests still cause intermittent failures.

## Solution

Make Test 2 self-contained by creating its own ruleset before testing update behavior. This eliminates inter-test dependencies entirely.

## Changes

### File: `test/integration/github-settings.test.ts`

**Modify Test 2** ("settings updates an existing ruleset") to:

1. Delete any existing test ruleset (idempotent cleanup)
2. Create ruleset via `xfg settings`
3. Wait for API visibility using existing `waitForRulesetVisible` helper
4. Capture ruleset ID
5. Run `xfg settings` again (the update under test)
6. Verify ruleset ID unchanged (update, not recreate)

**No changes to:**

- Test 1 (already self-contained)
- Test 3 (already calls `deleteRulesetIfExists()` first)
- Helper functions (`deleteRulesetIfExists`, `waitForRulesetVisible`)
- Before/after hooks

## Implementation

Update Test 2 to set up its own state before testing update behavior:

1. Call `deleteRulesetIfExists()` for clean state
2. Run `xfg settings` to create ruleset (using existing `exec` helper with hardcoded commands)
3. Parse and extract ruleset ID
4. Call `waitForRulesetVisible(rulesetId)` for API consistency
5. Run `xfg settings` again (the actual update under test)
6. Verify ruleset ID unchanged

Note: The test file uses `exec()` with hardcoded commands (not user input) as documented in the existing code comments at line 15-17.

## Trade-offs

| Aspect      | Impact                                                    |
| ----------- | --------------------------------------------------------- |
| Runtime     | +10-15 seconds (acceptable for CI-only integration tests) |
| API calls   | +1 `xfg settings` invocation                              |
| Reliability | Eliminates flakiness from inter-test dependencies         |

## Verification

1. Run `npm run test:integration:github` multiple times locally
2. Verify no flaky failures
3. CI on main branch should pass consistently after merge
