---
paths: test/integration/**/*,test/fixtures/integration-*,.github/workflows/ci.yaml,.github/scripts/*
---

# Integration Test Guidelines

## Repo Isolation

Each integration test job MUST use its own dedicated repo to enable parallel CI execution.

| Job                         | Repo         |
| --------------------------- | ------------ |
| `cli-sync-github-pat`       | `xfg-test`   |
| `cli-sync-github-app`       | `xfg-test-2` |
| `cli-settings-rulesets-pat` | `xfg-test-3` |
| `action-sync-pat`           | `xfg-test-4` |
| `action-sync-app`           | `xfg-test-5` |
| `action-settings-app`       | `xfg-test-6` |
| `cli-settings-repo-pat`     | `xfg-test-7` |

- **Never share a repo** between two test jobs
- When adding a new GitHub integration test, create a new dedicated repo
- Each CI job needs its own `concurrency.group` (e.g., `integration-github-N`)
- All GitHub jobs depend only on `build`, not on each other

## Reset-Before-Each Pattern

Tests MUST be self-contained: reset state in `beforeEach`, never rely on prior test cleanup.

- Use `reset-test-repo.sh` to nuke repo state (branches, PRs, rulesets, files)
- For repo settings tests, reset settings to defaults via `gh api --method PATCH`
- **Never delete and recreate repos** — GitHub's API has eventual consistency issues that cause ghost-repo race conditions where the name stays reserved for minutes

## Persistent Repos

Most test repos are **pre-created and permanent**:

- Created manually by the maintainer, not by test code
- Most tests must not call `gh repo create` or `gh repo delete`
- The GitHub App and PAT must have access to all test repos

### Ephemeral repos (lifecycle tests only)

Tests that verify repo creation/forking/migration may create and delete repos:

- Use **unique names per run** (`xfg-lifecycle-test-<timestamp>-<random>`) — never reuse a deleted name
- Register cleanup (`gh repo delete --yes`) in `afterEach` / `after`, wrapped in try/catch
- Never delete then recreate the same repo name — this causes ghost-repo race conditions
- Lifecycle tests use concurrency groups `integration-github-8` through `integration-github-11`

## Fixture Files

- Each job that uses a fixture needs its own fixture file with a unique `id` field
- Fixture `repos[].git` URL must point to the job's dedicated repo
- When a script like `seed-manifest.sh` needs the config ID, pass it as an argument

## CI Workflow

- GitHub integration tests only run on `push` to `main` (not on PR branches)
- All jobs run in parallel after `build` — never chain GitHub jobs with `needs`
- ADO and GitLab jobs are independent and use their own concurrency groups
