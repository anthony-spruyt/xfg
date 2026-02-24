# Labels Integration Tests Design

## Goal

Add integration tests for the GitHub labels feature that verify create, update, rename, idempotent re-run, dry-run, and delete-orphaned flows against a real GitHub repository.

## Test Infrastructure

**Repo:** `anthony-spruyt/xfg-test-8` (pre-created, permanent)
**CI job:** `integration-test-cli-settings-labels-pat`
**Concurrency group:** `integration-github-12`
**npm script:** `test:integration:github-labels`

## Files to Create/Modify

| File                                                       | Action                                |
| ---------------------------------------------------------- | ------------------------------------- |
| `test/integration/github-labels.test.ts`                   | Create - test file                    |
| `test/fixtures/integration-test-config-github-labels.yaml` | Create - base fixture                 |
| `.github/workflows/_integration-tests.yaml`                | Modify - add CI job                   |
| `.github/scripts/reset-test-repo.sh`                       | Modify - add label cleanup step       |
| `.claude/rules/integration-tests.md`                       | Modify - add xfg-test-8 to repo table |
| `package.json`                                             | Modify - add npm script               |

## Reset Script Change

Add a new step to `reset-test-repo.sh` (before rulesets) that deletes all labels via the GitHub API. Iterates label names from the paginated list endpoint, URL-encodes each name, and sends a DELETE request. This runs for all repos but is harmless when there are no labels.

## Config Fixture

Base fixture with two labels (`xfg-test-bug` and `xfg-test-feature`) pointing at `xfg-test-8`. Update/rename/delete tests will dynamically write modified configs.

## Test Scenarios

1. **Create labels** - Run settings, verify labels exist via API with correct name/color/description
2. **Update labels** - Create first, run again with modified color/description, verify changes
3. **Rename label** - Create, run with `new_name`, verify old gone and new exists
4. **Idempotent** - Run twice with same config, second run reports no changes
5. **Dry-run** - Run with `--dry-run`, verify output says DRY RUN and no labels created
6. **Delete orphaned** - Run with `deleteOrphaned: true`, then run again with label removed from config, verify deleted

## Test Structure

Follows `github-rulesets.test.ts` pattern: `beforeEach` calls `resetTestRepo()` via the shared reset script, tests run `node dist/cli.js settings --config <path>`, assertions verify state via `gh api`.

## CI Job

Standard settings test job pattern: checkout, integration-test-setup action, configure git, run npm script with `GH_TOKEN` from `secrets.GH_PAT`.
