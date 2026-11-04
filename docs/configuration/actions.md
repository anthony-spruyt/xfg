# GitHub Actions Settings

xfg can manage the **Actions settings page** of a GitHub repository (Settings > Actions > General) declaratively using the `sync` command: which actions may run, the default token permissions, who needs approval to run workflows from forks, and how long artifacts, logs and caches are kept.

!!! note "GitHub-Only Feature"
    Actions settings only apply to GitHub repositories. Azure DevOps and GitLab repos are skipped when running `xfg sync`.

## Quick Start

```yaml
id: my-config

settings:
  actions:
    allowedActions: selected
    githubOwnedAllowed: true
    verifiedAllowed: false
    patternsAllowed:
      - docker/login-action@*
      - amannn/action-semantic-pull-request@*
    shaPinningRequired: true
    defaultWorkflowPermissions: read
    canApprovePullRequestReviews: false
    forkPrApprovalPolicy: all_external_contributors

repos:
  - git: git@github.com:your-org/your-repo.git
```

```bash
# Preview changes (dry-run)
xfg sync -c config.yaml --dry-run

# Apply the Actions settings
xfg sync -c config.yaml
```

Every field is optional. xfg only touches what you configure: a field you leave out keeps whatever the repo has.

## Configuration Fields

| Field                          | Type                                                                                              | GitHub API                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `enabled`                      | boolean                                                                                           | `actions/permissions` `enabled`                                      |
| `allowedActions`               | `all`, `local_only` or `selected`                                                                 | `actions/permissions` `allowed_actions`                              |
| `shaPinningRequired`           | boolean                                                                                           | `actions/permissions` `sha_pinning_required`                         |
| `githubOwnedAllowed`           | boolean                                                                                           | `actions/permissions/selected-actions` `github_owned_allowed`        |
| `verifiedAllowed`              | boolean                                                                                           | `actions/permissions/selected-actions` `verified_allowed`            |
| `patternsAllowed`              | array of strings                                                                                  | `actions/permissions/selected-actions` `patterns_allowed`            |
| `defaultWorkflowPermissions`   | `read` or `write`                                                                                 | `actions/permissions/workflow` `default_workflow_permissions`        |
| `canApprovePullRequestReviews` | boolean                                                                                           | `actions/permissions/workflow` `can_approve_pull_request_reviews`    |
| `forkPrApprovalPolicy`         | `first_time_contributors_new_to_github`, `first_time_contributors` or `all_external_contributors` | `actions/permissions/fork-pr-contributor-approval` `approval_policy` |
| `artifactAndLogRetentionDays`  | positive integer                                                                                  | `actions/permissions/artifact-and-log-retention` `days`              |
| `cacheRetentionDays`           | positive integer                                                                                  | `actions/cache/retention-limit` `max_cache_retention_days`           |
| `cacheSizeGb`                  | positive integer                                                                                  | `actions/cache/storage-limit` `max_cache_size_gb`                    |

`canApprovePullRequestReviews` is GitHub's "Allow GitHub Actions to create and approve pull requests" switch, so it covers creating pull requests as well as approving them.

The schema reference lists the same fields with their descriptions: [`actionsSettings`](../reference/config-schema.md#actionssettings).

## Allowed Actions

`allowedActions` decides which actions and reusable workflows can run:

| Value        | Effect                                                                            |
| ------------ | --------------------------------------------------------------------------------- |
| `all`        | Any action or reusable workflow                                                   |
| `local_only` | Only actions and reusable workflows in the same repo or organization              |
| `selected`   | Only the ones `githubOwnedAllowed`, `verifiedAllowed` and `patternsAllowed` allow |

`githubOwnedAllowed`, `verifiedAllowed` and `patternsAllowed` only apply when `allowedActions` is `selected`. `patternsAllowed` entries look like `owner/repo@*`, or `owner/*` for everything from an owner. A pattern that starts with `!` blocks the action instead.

xfg compares `patternsAllowed` as a set, so reordering the list is not a change.

!!! note "First run on a repo"
    GitHub only returns the selected-actions list while `allowedActions` is `selected`. On a repo that is not in that mode yet, the plan shows `githubOwnedAllowed`, `verifiedAllowed` and `patternsAllowed` as new values, and xfg switches the mode before it writes them.

## Workflow Permissions

`defaultWorkflowPermissions` sets what the `GITHUB_TOKEN` can do in workflows that don't declare their own `permissions:`. `read` gives read access to repository contents and packages. Workflows that write (push, create releases, comment on pull requests) then need an explicit `permissions:` block.

## Disabling Actions

```yaml
id: no-actions

settings:
  actions:
    enabled: false

repos:
  - git: git@github.com:your-org/docs-only.git
```

With `enabled: false` the repo's other Actions fields are not allowed in the same layer: `allowedActions`, `shaPinningRequired` and the selected-actions fields fail validation, because GitHub rejects them while Actions is off.

## Inheritance

`actions` merges from root to group to repo, field by field, like `settings.repo`. A repo that sets one field keeps the rest of the inherited block.

`patternsAllowed` is the exception: a layer that sets it replaces the inherited list whole. Lists are not appended.

```yaml
id: actions-baseline

settings:
  actions:
    allowedActions: selected
    githubOwnedAllowed: true
    patternsAllowed:
      - docker/login-action@*
    defaultWorkflowPermissions: read

repos:
  - git: git@github.com:your-org/api-service.git
  - git: git@github.com:your-org/web-app.git
    settings:
      actions:
        patternsAllowed:
          - docker/login-action@*
          - aquasecurity/trivy-action@*
  - git: git@github.com:your-org/scratch.git
    settings:
      actions:
        allowedActions: all   # overrides selected; the inherited selected-actions fields are ignored
```

When the merged `allowedActions` is set to `all` or `local_only`, xfg ignores the selected-actions fields and prints a warning, so a repo can override an inherited `selected` without restating the block. When the merged `enabled` is `false`, it ignores `allowedActions`, `shaPinningRequired` and the selected-actions fields the same way.

The same goes for a repo that has Actions turned off when you run xfg and whose merged config doesn't set `enabled`: xfg ignores those fields with a warning, because GitHub rejects them while Actions is off. Set `enabled: true` to turn Actions on and apply them.

## Per-Repo Opt-Out

To exclude a repo from inherited Actions settings, set `actions: false` at the repo or group level:

```yaml
id: my-config

settings:
  actions:
    allowedActions: selected
    githubOwnedAllowed: true
    shaPinningRequired: true

repos:
  - git: git@github.com:your-org/main-app.git
  - git: git@github.com:your-org/private-repo.git
    settings:
      actions: false  # Leave this repo's Actions settings alone
```

`actions: false` is only valid when an inherited `actions` block exists, and not at root level.

## Validation

xfg checks each layer before it syncs:

- `allowedActions`, `defaultWorkflowPermissions` and `forkPrApprovalPolicy` must be one of the listed values.
- The retention and size fields must be positive integers. GitHub enforces the upper limit, which depends on visibility and plan, and xfg shows its error.
- `patternsAllowed` entries must be non-empty strings.
- A layer that sets `githubOwnedAllowed`, `verifiedAllowed` or `patternsAllowed` together with an `allowedActions` other than `selected` is an error.
- A layer that sets `enabled: false` together with `allowedActions`, `shaPinningRequired` or a selected-actions field is an error.
- After the layers merge, a repo whose block sets `githubOwnedAllowed`, `verifiedAllowed` or `patternsAllowed` must get an `allowedActions` from some layer, otherwise the config is rejected. A layer can leave `allowedActions` out and inherit it.
- A config whose only `actions` block is empty does not count as having settings to sync.

## What xfg Calls

xfg calls only the endpoints that hold a field you configured, and writes only the ones with a difference:

1. `GET actions/permissions` first. `GET actions/permissions/selected-actions` only when the repo is in `selected` mode.
2. `GET` for every other endpoint you configured.
3. `PUT` for each endpoint that differs, `actions/permissions` before `actions/permissions/selected-actions`.

A config without cache fields never calls the cache endpoints. When a `PUT` needs a field you did not configure, xfg sends the repo's current value for it.

With `--dry-run`, xfg reads the live values and prints the plan as `old → new` per field, and writes nothing. The settings report lists each change as `actions.<field>`.

## Permissions

The credential xfg runs with needs **Administration: Read and write** on the repo. Reading `actions/cache/storage-limit` also needs **Actions: Read**. See [GitHub App Authentication](../platforms/github-app.md).

## Limits

- GitHub returns errors for settings the repo can't take, for example when an organization or enterprise policy controls the setting (`409`), or an unsupported value (`422`). xfg shows GitHub's message and the run exits non-zero.
- `forkPrApprovalPolicy` applies to public repos only; GitHub rejects it on a private or internal repo, which fails the Actions block in the plan and on apply. A private repo that inherits it opts out with `actions: false`, because inheritance merges field by field and can't remove a single inherited field.
- `cacheRetentionDays` and `cacheSizeGb` need a paid plan or a payment method on file; GitHub rejects the write otherwise.
- xfg does not manage organization or enterprise Actions policies, settings that only exist for private repositories, or OIDC subject customization.
