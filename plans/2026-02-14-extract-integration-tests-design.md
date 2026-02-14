# Design: Extract Integration Tests to Reusable Workflow

**Issue:** [#473](https://github.com/anthony-spruyt/xfg/issues/473)
**Date:** 2026-02-14
**Approach:** A+C — local reusable workflow with composite action for common setup

## Problem

`ci.yaml` is ~858 lines. 13 integration test jobs are defined inline (lines 81–837), making the file hard to review and modify. Lint and summary are already extracted as reusable workflows.

## Design

### Composite Action: `.github/actions/integration-test-setup/action.yaml`

Extracts the common setup steps shared by all 13 jobs.

**Inputs:**

- `download-package` (boolean, default `false`) — download the `package` artifact and set `XFG_PACKAGE` env var

**Steps:**

1. `actions/checkout@v6`
2. `actions/setup-node@v6` — node 24, npm cache
3. `npm ci`
4. `actions/download-artifact@v7` — download `dist` to `dist/`
5. (if `download-package`) `actions/download-artifact@v7` — download `package`
6. (if `download-package`) Set `XFG_PACKAGE` env var

**Which jobs need `download-package: true`:** the 5 action tests (`action-sync-pat`, `action-sync-app`, `action-settings-app`, `action-lifecycle-pat`, `action-lifecycle-app`). The 8 CLI tests only need `dist`.

### Reusable Workflow: `.github/workflows/_integration-tests.yaml`

**Trigger:** `workflow_call` with no inputs. Secrets passed via `secrets: inherit`.

All 13 jobs move here from `ci.yaml` with these changes per job:

- **Remove** `needs: [build]` — caller handles ordering
- **Remove** `if:` condition — caller handles the push event gate
- **Replace** common setup steps with `uses: ./.github/actions/integration-test-setup`

Each job retains its own `concurrency.group`, `cancel-in-progress: false`, job-level `env` blocks, and job-specific steps.

### Refactored `ci.yaml`

Remove all 13 jobs. Add a single caller:

```yaml
integration-tests:
  needs: [build]
  if: ${{ !failure() && !cancelled() && github.event_name == 'push' }}
  uses: ./.github/workflows/_integration-tests.yaml
  secrets: inherit
```

Update `summary` needs to `[lint, build, integration-tests]` instead of listing all 13 jobs.

## File Changes

| File                                                 | Change                               |
| ---------------------------------------------------- | ------------------------------------ |
| `.github/actions/integration-test-setup/action.yaml` | New — composite action               |
| `.github/workflows/_integration-tests.yaml`          | New — reusable workflow with 13 jobs |
| `.github/workflows/ci.yaml`                          | Modify — remove 13 jobs, add caller  |

## Edge Cases

- **`_summary.yaml`** dynamically discovers jobs via API — no hardcoded names to update. Nested jobs appear as `integration-tests / <job-name>`.
- **Artifacts** are accessible across reusable workflows in the same run.
- **Branch protection** only references `summary / Check Results` — unaffected.

## No Behavioral Change

Same jobs, same parallelism, same concurrency groups, same secrets. Pure refactor.
