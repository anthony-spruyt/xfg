# GitHub Operations

> **Repository: detect owner/repo from `git remote get-url origin`**

## Tool Priority

1. **GitHub MCP tools** (`mcp__github__*`) — preferred for all operations
2. **`gh` CLI** — fallback when MCP tools can't do the operation

MCP tools use the GitHub App identity. CLI uses the user's token. Prefer MCP.

## MCP Capabilities

| Operation | MCP Support |
|-----------|-------------|
| Read issues | Yes |
| Create/update issues | Yes |
| Comment on issues | Yes |
| Read PRs (metadata, diff, files) | Yes |
| Create PRs | Yes |
| Merge PRs | No — use CLI |
| Review PRs | No — use CLI |
| Search issues/PRs/code | Yes |
| Close issues | No — use CLI |
| PR checks/status | No — use CLI |
| Raw API calls | No — use CLI |
| Checkout PR branch | No — use CLI |

## Rules

1. Never output secret values from issues or PRs
2. Never close issues without validated success; if validation isn't possible, get user confirmation first
3. Always post agent results (validation, QA, reviews) as issue comments, never edit issue body
