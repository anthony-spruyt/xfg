# GitHub Operations

> **Repository: detect owner/repo from `git remote get-url origin`**

## Tool

Use the **`gh` CLI** for all GitHub operations (issues, PRs, code search, API calls).

## Rules

1. Never output secret values from issues or PRs
2. Never close issues without validated success; if validation isn't possible, get user confirmation first
3. Post validator and reviewer reports (validation, QA, reviews) as issue comments, never into the issue body
4. Keep the issue body current with the work itself (scope, findings, plan, checklist); edit it rather than burying updates in comments
5. Fill PR bodies from `.github/pull_request_template.md` when it exists

## Issue Lifecycle

When work needs an issue:

1. Search for an existing issue by keywords before creating one
2. Create it from `.github/ISSUE_TEMPLATE/` when that exists, using the template's title prefix, labels, and fields
3. Reference it in every commit: `Ref #123`
4. Label it `blocked` while it waits on an upstream fix or external dependency
