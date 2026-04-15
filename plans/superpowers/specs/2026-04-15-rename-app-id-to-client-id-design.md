# Rename `appId` → `clientId` (xfg v6.0.0)

**Issue:** [#700](https://github.com/anthony-spruyt/xfg/issues/700)
**Status:** Approved design
**Date:** 2026-04-15

## Goal

Rename all xfg-owned names from "App ID" to "Client ID" to accurately reflect that these values hold GitHub App Client IDs (`Iv23…`), not numeric App IDs. This is a breaking change released as v6.0.0 — no aliases, no deprecation shims.

Octokit's `createAppAuth({ appId })` parameter name is third-party and stays as-is; we pass our `clientId` variable into that parameter at the call boundary. Octokit accepts Client IDs there.

## External surface changes (breaking)

| Old | New |
| --- | --- |
| `action.yml` input `github-app-id` | `github-client-id` |
| Env var `XFG_GITHUB_APP_ID` | `XFG_GITHUB_CLIENT_ID` |

No backwards-compatible aliases. No fallback reads of the old env var. No deprecation warnings. Users must update to the new names when upgrading to v6.0.0.

## Internal renames (xfg-owned code)

- `GitHubAppTokenManager` (`src/vcs/github-app-token-manager.ts`):
  - Constructor parameter: `appId` → `clientId`
  - Private field: `this.appId` → `this.clientId`
  - JWT `iss` claim: continues to use `this.clientId` (GitHub accepts Client IDs in the `iss` claim)
- `createTokenManager` factory (`src/vcs/index.ts` and callers): options object key `appId` → `clientId`
- `src/cli/sync-command.ts`: read `process.env.XFG_GITHUB_CLIENT_ID`, pass as `clientId`
- Any other xfg-owned types, interfaces, config keys, variables, or identifiers named `appId` / `APP_ID` → `clientId` / `CLIENT_ID`
- Octokit call boundary: if `createAppAuth({ appId: ... })` is called anywhere in our code, the key `appId` stays (Octokit's API) but the value passed is our renamed `clientId` variable

## Tests

- Update `test/unit/github-app-token-manager.test.ts`, `test/unit/repository-processor.test.ts`, `test/unit/vcs/commit-strategy-selector.test.ts`, and any other unit tests that reference the old names.
- Update `test/integration/github-app.test.ts` and `test/integration/github-lifecycle-app.test.ts` to use the new env var name.
- Update any test fixtures and mocks.
- No new tests needed — this is a pure rename with no behavior change.

## Docs and workflow

- `docs/platforms/github-app.md` — env var name, setup steps
- `.github/workflows/_integration-tests.yaml` — use `github-client-id` input; reference `XFG_GITHUB_CLIENT_ID` where applicable
- `docs/ci-cd/github-actions.md` — any references to the old input/env var
- `README.md` — quick-start examples, if they reference either name
- Repo variables (`RELEASE_CLIENT_ID`, `TEST_CLIENT_ID`) are already renamed per #699 — this design does not touch them

## Verification

Before PR (per `CLAUDE.md` pre-PR checklist):

1. `npm test`
2. `npm run test:typecheck`
3. `./lint.sh`
4. `npm run test:integration:github`
5. `npm run test:integration:ado`
6. `npm run test:integration:gitlab`

## Release

After merge to main:

```bash
gh workflow run release.yaml -f version=major
```

Release notes must call out the breaking change with a migration snippet:

```text
# Migration for xfg v6.0.0
#   action.yml input: github-app-id → github-client-id
#   env var:          XFG_GITHUB_APP_ID → XFG_GITHUB_CLIENT_ID
```

## Out of scope

- Octokit's `createAppAuth({ appId })` parameter name — third-party, we don't own it
- Any further changes to #699's already-renamed repo variables (`RELEASE_CLIENT_ID`, `TEST_CLIENT_ID`)
- Deprecation shims or dual-name support
