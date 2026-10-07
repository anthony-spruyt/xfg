---
paths: [packages/xfg/test/integration/**/*, packages/xfg/test/fixtures/integration-*, .github/workflows/ci.yaml, .github/workflows/_integration-tests.yaml, .github/scripts/*]
---

# Integration Test Guidelines

## Ephemeral Repo Pattern

All GitHub integration tests use **ephemeral repos** with unique names per run. No persistent test repos exist.

### CLI Tests

Each CLI test file creates its own ephemeral repo in `before()` and deletes it in `after()`. Configs are written inline via `writeConfig()` (from `packages/xfg/test/integration/test-helpers.ts`):

```typescript
const OWNER = "spruyt-labs";
let repoName: string;
let testRepo: string;

before(() => {
  repoName = generateRepoName("<purpose>");
  testRepo = `${OWNER}/${repoName}`;
  createRepo(OWNER, repoName);
});

after(() => {
  deleteRepo(OWNER, repoName);
});
```

### Action Tests

Action jobs use `create-ephemeral-repo-config.sh --fixture` to generate configs from templates with `OWNER/REPO_PLACEHOLDER` substitution. Cleanup uses `delete-ephemeral-repo.sh` with `if: always()`.

### Lifecycle Tests

Lifecycle tests (create/fork/migrate) create and delete repos as part of their test logic. Use `generateRepoName("lifecycle")` for unique names.

## Key Rules

- **All tests use `gh repo create` / `gh repo delete`** for ephemeral repos
- **Never reuse a deleted repo name** - GitHub has eventual consistency; use unique timestamp+random names
- **Never share a repo** between two test jobs
- Inline configs via `writeConfig()` (from `packages/xfg/test/integration/test-helpers.ts`) - no static fixture files for CLI tests
- Action fixture templates use `OWNER/REPO_PLACEHOLDER` placeholder
- All GitHub jobs use `GH_PAT_ORG` secret (spruyt-labs org access); the ADO and GitLab jobs use `AZURE_DEVOPS_EXT_PAT` and `GITLAB_TOKEN`. All integration secrets are stored only in the `integration` and `integration-main` environments, and every job that reads one runs in `environment: ${{ inputs.environment }}` (enforced by `test/unit/ci/integration-workflow.test.ts`)
- A reusable workflow sees an environment secret only when the caller passes it by name, even if the caller has no value for it: every secret `_integration-tests.yaml` uses must be declared in its `workflow_call.secrets` and passed by `ci.yaml` (enforced by `test/unit/ci/integration-workflow.test.ts`)
- **No concurrency groups** on GitHub jobs (ephemeral repos can't collide)
- **No `needs` between GitHub jobs**: approval is per waiting job, so a chained job asks the owner again. Add new suites as steps in an existing lane
- Every environment job runs `require-env-secrets.sh` before any step that uses a secret, listing each environment secret it uses; `test/unit/ci/integration-workflow.test.ts` enforces this and `timeout-minutes` on every lane
- ADO and GitLab jobs use persistent repos with cross-run concurrency groups. A PR job waiting for approval holds its group: main's job waits behind it, and a third run in the group cancels the waiting one. Approve or reject PR runs promptly

## CI Workflow

- Integration tests always run on `push` to `main` (when source changes detected), using the `integration-main` environment (main branch only, no approval)
- On PRs, integration tests only run when:
  - The `run-integration` label is added to the PR, OR
  - Integration test files (`packages/xfg/test/integration/`) are changed
- PR runs use the `integration` environment: the owner approves once per run, then all lanes start together. Merge-queue and fork PRs skip integration
- GitHub tests run in 5 parallel lanes to stay under API secondary rate limits
