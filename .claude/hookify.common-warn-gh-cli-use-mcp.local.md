---
name: gh-cli-use-mcp
enabled: true
event: bash
pattern: \bgh\s+(issue|pr|search\s+(issues|code|prs))\s
action: warn
---

Use `mcp__github__*` MCP tools instead of `gh` CLI for GitHub operations. Available MCP tools: `add_issue_comment`, `issue_read`, `issue_write`, `pull_request_read`, `pull_request_review_write`, `search_issues`, `search_code`, `list_pull_requests`, `merge_pull_request`, `create_pull_request`.
