# Design: Fetch Security Settings for Accurate Diff

**Issue:** [#421](https://github.com/anthony-spruyt/xfg/issues/421)
**Date:** 2026-02-08

## Problem

Security settings (`vulnerabilityAlerts`, `automatedSecurityFixes`, `privateVulnerabilityReporting`) show as `+` (additions) instead of `~` (changes) in `xfg settings` output. These settings always exist on GitHub repos, so they should show current → desired values.

## Root Cause

`GitHubRepoSettingsStrategy.getSettings()` only fetches from `/repos/{owner}/{repo}`, but security settings require separate endpoints:

| Setting                         | Endpoint                                                | Response Pattern               |
| ------------------------------- | ------------------------------------------------------- | ------------------------------ |
| `vulnerabilityAlerts`           | `/repos/{owner}/{repo}/vulnerability-alerts`            | 204 = enabled, 404 = disabled  |
| `automatedSecurityFixes`        | `/repos/{owner}/{repo}/automated-security-fixes`        | 204 = enabled, 404 = disabled  |
| `privateVulnerabilityReporting` | `/repos/{owner}/{repo}/private-vulnerability-reporting` | JSON `{"enabled": true/false}` |

## Solution

### Approach

Sequential fetches in `getSettings()` - fetch main repo endpoint, then fetch all 3 security endpoints and merge results. Matches existing simple, linear style.

### Error Handling

- **204** → `true` (enabled)
- **404** → `false` (disabled) - check for "HTTP 404" in error message
- **Other errors** → propagate (fail fast, consistent with existing pattern)

No transient error handling (deferred to #422).

### File Changes

#### `src/strategies/repo-settings-strategy.ts`

Add fields to `CurrentRepoSettings` interface:

```typescript
export interface CurrentRepoSettings {
  // ... existing fields ...

  // Security settings (fetched from separate endpoints)
  vulnerability_alerts?: boolean;
  automated_security_fixes?: boolean;
  private_vulnerability_reporting?: boolean;
}
```

#### `src/strategies/github-repo-settings-strategy.ts`

Add 3 private helper methods:

```typescript
private async getVulnerabilityAlerts(
  github: GitHubRepoInfo,
  options?: RepoSettingsStrategyOptions
): Promise<boolean> {
  const endpoint = `/repos/${github.owner}/${github.repo}/vulnerability-alerts`;
  try {
    await this.ghApi("GET", endpoint, undefined, options);
    return true; // 204 = enabled
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("HTTP 404")) {
      return false; // 404 = disabled
    }
    throw error; // Re-throw other errors
  }
}

private async getAutomatedSecurityFixes(
  github: GitHubRepoInfo,
  options?: RepoSettingsStrategyOptions
): Promise<boolean> {
  const endpoint = `/repos/${github.owner}/${github.repo}/automated-security-fixes`;
  try {
    await this.ghApi("GET", endpoint, undefined, options);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("HTTP 404")) {
      return false;
    }
    throw error;
  }
}

private async getPrivateVulnerabilityReporting(
  github: GitHubRepoInfo,
  options?: RepoSettingsStrategyOptions
): Promise<boolean> {
  const endpoint = `/repos/${github.owner}/${github.repo}/private-vulnerability-reporting`;
  const result = await this.ghApi("GET", endpoint, undefined, options);
  const data = JSON.parse(result);
  return data.enabled === true;
}
```

Update `getSettings()`:

```typescript
async getSettings(
  repoInfo: RepoInfo,
  options?: RepoSettingsStrategyOptions
): Promise<CurrentRepoSettings> {
  this.validateGitHub(repoInfo);
  const github = repoInfo as GitHubRepoInfo;

  const endpoint = `/repos/${github.owner}/${github.repo}`;
  const result = await this.ghApi("GET", endpoint, undefined, options);
  const settings = JSON.parse(result) as CurrentRepoSettings;

  // Fetch security settings from separate endpoints
  settings.vulnerability_alerts = await this.getVulnerabilityAlerts(github, options);
  settings.automated_security_fixes = await this.getAutomatedSecurityFixes(github, options);
  settings.private_vulnerability_reporting = await this.getPrivateVulnerabilityReporting(github, options);

  return settings;
}
```

#### `src/repo-settings-diff.ts`

Update `PROPERTY_MAPPING` to use real field names:

```typescript
const PROPERTY_MAPPING: Record<keyof GitHubRepoSettings, string> = {
  // ... existing mappings ...
  vulnerabilityAlerts: "vulnerability_alerts", // was "_vulnerability_alerts"
  automatedSecurityFixes: "automated_security_fixes", // was "_automated_security_fixes"
  privateVulnerabilityReporting: "private_vulnerability_reporting", // was "_private_vulnerability_reporting"
};
```

Remove special-case logic in `getCurrentValue()` - the `if (apiKey.startsWith("_"))` block is no longer needed for these three fields.

### Unit Tests

Add to `test/unit/strategies/github-repo-settings-strategy.test.ts`:

1. `getVulnerabilityAlerts` returns `true` on 204 (empty response)
2. `getVulnerabilityAlerts` returns `false` on 404
3. `getVulnerabilityAlerts` throws on other errors (500, auth)
4. Same 3 tests for `getAutomatedSecurityFixes`
5. `getPrivateVulnerabilityReporting` returns `true` when `{"enabled": true}`
6. `getPrivateVulnerabilityReporting` returns `false` when `{"enabled": false}`
7. `getSettings` fetches all 4 endpoints and merges security settings
8. `getSettings` passes options (token, host) to security endpoint calls

Enhance `MockExecutor` to simulate errors via `setErrorResponse(pattern, errorMessage)`.

### Integration Tests

Update `test/integration/github-repo-settings.test.ts`:

1. Add security settings to config file:

   ```yaml
   settings:
     repo:
       vulnerabilityAlerts: true
       automatedSecurityFixes: false
       privateVulnerabilityReporting: true
   ```

2. Add `getSecuritySettings()` helper to read current state from all 3 endpoints

3. Add `resetSecuritySettings()` to disable all 3 before each test

4. Add assertions verifying security settings are applied correctly

5. Verify dry-run output shows `~` (change) not `+` (add) for security settings

## Expected Behavior After Fix

```
Repo Settings:
  ~ allowMergeCommit: true → false
  ~ automatedSecurityFixes: true → false
  ~ privateVulnerabilityReporting: false → true
  ~ vulnerabilityAlerts: false → true
```

## Related Issues

- #418 - GitHub App token support (released in v3.7.2)
- #422 - Audit transient error handling (future work)
