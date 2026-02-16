# Private Repo Security Settings Validation

## Problem

GitHub restricts certain security settings based on repository visibility and owner type:

- `privateVulnerabilityReporting` is only available on **public** repositories
- `secretScanning` and `secretScanningPushProtection` are only available on **public** repos, or **org-owned private** repos with GitHub Secret Protection (GHAS) enabled

When xfg applies these settings to ineligible repos, the GitHub API returns 404 or 422 errors. These should be caught and reported as validation errors before attempting to apply, including in dry-run (plan) mode.

## Constraints

- Eligibility depends on runtime state (repo visibility, owner type, GHAS enrollment) — not statically determinable from config alone
- Must work in both dry-run and apply modes
- Fail the individual repo only; other repos continue processing

## Design

### 1. Capture `owner_type` from GitHub API

The `GET /repos/{owner}/{repo}` response includes `owner.type` (`"User"` or `"Organization"`). Add this to `CurrentRepoSettings` and extract it in `GitHubRepoSettingsStrategy.getSettings()`.

### 2. Runtime pre-diff validation in `RepoSettingsProcessor.process()`

After `getSettings()` returns but before `diffRepoSettings()`, validate:

| Desired setting                       | Fail when                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------- |
| `privateVulnerabilityReporting: true` | `visibility !== "public"`                                                                   |
| `secretScanning: true`                | `visibility !== "public"` AND (`owner_type === "User"` OR `security_and_analysis === null`) |
| `secretScanningPushProtection: true`  | `visibility !== "public"` AND (`owner_type === "User"` OR `security_and_analysis === null`) |

### 3. Error reporting

Return `success: false` with a descriptive error message for the repo. Examples:

- `"privateVulnerabilityReporting is only available for public repositories"`
- `"secretScanning requires GitHub Advanced Security (not available for this repository)"`

### Files to modify

| File                                                          | Change                                                            |
| ------------------------------------------------------------- | ----------------------------------------------------------------- |
| `src/settings/repo-settings/types.ts`                         | Add `owner_type?: string` to `CurrentRepoSettings`                |
| `src/settings/repo-settings/github-repo-settings-strategy.ts` | Extract `owner.type` in `getSettings()`                           |
| `src/settings/repo-settings/processor.ts`                     | Add validation after `getSettings()`, before `diffRepoSettings()` |
| Tests for all three files                                     | TDD: write failing tests first                                    |
