---
paths: [test/integration/**/*, test/fixtures/integration-*, .github/workflows/ci.yaml, .github/scripts/*]
---

# Integration Test Guidelines

## Ephemeral Repo Pattern

All GitHub integration tests use **ephemeral repos** with unique names per run. No persistent test repos exist.

### CLI Tests

Each CLI test file creates its own ephemeral repo in `before()` and deletes it in `after()`. Configs are written inline via `writeConfig()` (from `test/integration/test-helpers.ts`):

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

- **All tests use `gh repo create` / `gh repo delete`** for ephemeral repos (this replaces the old persistent-repo model)
- **Never reuse a deleted repo name** - GitHub has eventual consistency; use unique timestamp+random names
- **Never share a repo** between two test jobs
- Inline configs via `writeConfig()` (from `test/integration/test-helpers.ts`) - no static fixture files for CLI tests
- Action fixture templates use `OWNER/REPO_PLACEHOLDER` placeholder
- All GitHub jobs use `GH_PAT_ORG` secret (spruyt-labs org access)
- **No concurrency groups** on GitHub jobs (ephemeral repos can't collide)
- ADO and GitLab jobs still use persistent repos with concurrency groups

## CI Workflow

- Integration tests always run on `push` to `main` (when source changes detected)
- On PRs, integration tests only run when:
  - The `run-integration` label is added to the PR, OR
  - Integration test files (`test/integration/`) are changed
- GitHub integration jobs are chained via `needs` in batches to avoid API rate limits
