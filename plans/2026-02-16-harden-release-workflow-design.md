# Harden Release Workflow - Design

## Problem

The current release workflow is a single monolithic job with 10+ steps. Any step failure (transient API errors, self-deadlock in CI polling, permission issues) requires a full manual restart. Observed failures:

- **Transient GitHub API error** in `verified-bot-commit@v2` ("Object does not exist" on ref update) - succeeded on retry
- **Self-deadlock** in "Wait for CI to pass" - the release workflow's own check run was counted as pending, causing infinite wait (patched by name-based filtering, but fragile)
- **No idempotency** - re-running after partial failure can double-bump versions

## Solution: Two-Phase Release

Split the release into two independent workflows with idempotency at each step.

### Phase 1: `release.yaml` (manual dispatch)

Bumps version and creates verified commit. Nothing else.

```
Trigger: workflow_dispatch (version: patch|minor|major)
Steps:
  1. Checkout main
  2. Generate app token
  3. Idempotency guard: skip if HEAD is already a "chore: release v" commit
  4. Setup Node.js, npm ci
  5. npm version <type> --no-git-tag-version
  6. npm run build
  7. Create verified commit (iarekylew00t/verified-bot-commit@v2)
     - files: package.json, package-lock.json
     - message: "chore: release vX.Y.Z"
```

Duration: ~30 seconds. Single failure point (verified-bot-commit). If it fails, re-dispatch.

### Phase 2: `release-publish.yaml` (auto on push to main)

Triggers on push to main, detects release commits, waits for CI, then tags and publishes.

```
Trigger: push to main
Condition: commit message matches "chore: release v*"
Steps:
  1. Extract version from commit message
  2. Wait for CI to pass (poll check-runs, exclude own workflow name)
  3. Create lightweight tag vX.Y.Z (skip if exists)
  4. Update floating major version tag v3 (skip if current)
  5. Publish to npm (skip if version already published)
  6. Create GitHub Release (skip if exists)
```

Each step checks for prior completion, so re-running after partial failure resumes where it left off.

### Self-Deadlock Elimination

Phase 2 is a separate workflow (`release-publish`) triggered by `push`, not `workflow_dispatch`. Its check runs are on a different workflow than the CI check runs for the commit. The polling loop only needs to watch CI workflow check runs and exclude `release-publish`.

### Error Recovery

| Failure                                        | Recovery                                                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Phase 1: verified-bot-commit transient failure | Re-dispatch. Idempotency guard prevents double-bump.                                               |
| Phase 2: CI fails on release commit            | Fix issue, push to main. Phase 2 won't re-trigger (different commit message). Re-dispatch Phase 1. |
| Phase 2: Tag/publish/release fails             | Re-run workflow. Each step has idempotency check.                                                  |

### What Changes

**`release.yaml` (modified):** Remove everything after verified-bot-commit (CI wait, tagging, npm publish, GitHub release). Remove pre-flight CI check (Phase 2 handles gating). Add idempotency guard.

**`release-publish.yaml` (new):** Contains the tag/publish/release steps with CI wait polling and idempotency checks.

### Constraints

- Verified commit is required (GPG-signed "Verified" badge)
- App token used for both phases (via `actions/create-github-app-token@v2`)
- npm provenance signing retained (`--provenance`)
- `npm` environment required for publish step (OIDC)
