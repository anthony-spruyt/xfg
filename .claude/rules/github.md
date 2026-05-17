# GitHub Operations

> **Repository: detect owner/repo from `git remote get-url origin`**

## Tool

Use the **`gh` CLI** for all GitHub operations (issues, PRs, code search, API calls).

## Rules

1. Never output secret values from issues or PRs
2. Never close issues without validated success; if validation isn't possible, get user confirmation first
3. Always post agent results (validation, QA, reviews) as issue comments, never edit issue body
