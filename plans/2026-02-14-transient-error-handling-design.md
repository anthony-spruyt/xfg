# Transient Error Handling Audit and Fix

**Issue:** [#422](https://github.com/anthony-spruyt/xfg/issues/422)
**Related:** [#471](https://github.com/anthony-spruyt/xfg/issues/471) (closed — owner prefers retry over delays)
**Date:** 2026-02-14

## Problem

Three strategy classes make API calls without retry logic, while the rest of the codebase uses `withRetry()` consistently. A transient failure (rate limit, network timeout, 5xx) in these strategies causes the entire operation to fail.

## Audit Results

| Component                    | API Type       | Retry Status                               |
| ---------------------------- | -------------- | ------------------------------------------ |
| GitHubRepoSettingsStrategy   | gh api         | NO RETRY                                   |
| GitHubRulesetStrategy        | gh api         | NO RETRY                                   |
| GraphQLCommitStrategy        | gh api graphql | PARTIAL (OID retry only, no network retry) |
| GitHubPRStrategy             | gh CLI         | Full                                       |
| AzurePRStrategy              | az CLI         | Full                                       |
| GitLabPRStrategy             | glab CLI       | Full                                       |
| GitHubLifecycleProvider      | gh CLI         | Full                                       |
| GitOps / AuthenticatedGitOps | git            | Full (network ops)                         |

## Approach

Wrap the command executor calls with the existing `withRetry()` utility in the 3 identified gaps. This follows the identical pattern already used in GitHubPRStrategy, AzurePRStrategy, GitLabPRStrategy, and GitHubLifecycleProvider.

Alternatives considered:

- **Shared `ghApiWithRetry()` helper** — rejected. The two `ghApi()` methods differ (PATCH support, different option types) and share no interface. Extracting a helper creates coupling between unrelated strategies.
- **Retry at executor level** — rejected. Violates SRP (executor gains retry responsibility), LSP (changes contract for all callers), and OCP (modifies existing class behavior). Callers like `lsRemote` expect immediate failure.

## Changes

### 1. GitHubRepoSettingsStrategy.ghApi()

`src/settings/repo-settings/github-repo-settings-strategy.ts`

- Import `withRetry` from `../../shared/retry-utils.js`
- Wrap both command execution paths (with-payload and without-payload) in `withRetry()`
- Default 3 retries, exponential backoff

**404 handling preserved:** Methods like `getVulnerabilityAlerts()` catch 404 to return boolean. This works because `isPermanentError()` matches 404 and throws `AbortError`, which preserves the original message. The caller's catch block checks `message.includes("HTTP 404")` and handles it correctly.

### 2. GitHubRulesetStrategy.ghApi()

`src/settings/rulesets/github-ruleset-strategy.ts`

- Import `withRetry` from `../../shared/retry-utils.js`
- Wrap both command execution paths in `withRetry()`
- Default 3 retries, exponential backoff

### 3. GraphQLCommitStrategy.executeGraphQLMutation()

`src/vcs/graphql-commit-strategy.ts`

- Import `withRetry` and `DEFAULT_PERMANENT_ERROR_PATTERNS` from `../shared/retry-utils.js`
- Wrap the single command execution call in `withRetry()` with custom permanent error patterns that include OID mismatch patterns
- **OID mismatch handling:** The existing retry loop in `commit()` handles OID mismatch by fetching a fresh HEAD OID before retrying. The inner `withRetry()` must treat OID mismatch as a permanent error (abort immediately) so the outer loop can handle it properly. Without this, `withRetry()` would waste 3 API calls retrying with a stale OID before the outer loop gets to fix it.

## Error Flow

```
command execution fails
  -> withRetry() checks isPermanentError()
    -> permanent (401, 403, 404, auth) -> AbortError -> thrown immediately
    -> transient (429, 500-504, timeout, network) -> retry up to 3 times
    -> unknown -> retry up to 3 times (safe default)
```

## Testing

For each modified strategy:

- Transient errors are retried (mock executor to fail then succeed)
- Permanent errors fail immediately without retry
- The 404-as-boolean pattern in settings strategy works through retry
- OID mismatch errors in GraphQLCommitStrategy are not wasted on inner retry (outer loop handles them)
