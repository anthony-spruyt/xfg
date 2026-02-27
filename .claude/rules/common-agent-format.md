---
paths: [.claude/agents/*.md]
---

# Agent File Format

## Frontmatter

### Required Fields

| Field         | Format                       | Notes                                                                 |
| ------------- | ---------------------------- | --------------------------------------------------------------------- |
| `name`        | lowercase-hyphen, 3-50 chars | Unique identifier                                                     |
| `description` | Single line with `\n`        | Triggers + examples (see below). No hard max length, but keep concise |

### Optional Fields

| Field             | Format / Values                                                  | Notes                                   |
| ----------------- | ---------------------------------------------------------------- | --------------------------------------- |
| `model`           | `opus`, `sonnet`, `haiku`, `inherit`                             | Defaults to `inherit`                   |
| `tools`           | Comma-separated string: `Read, Bash, Grep`                       | Inherits all if omitted                 |
| `disallowedTools` | Comma-separated string: `Write, Edit`                            | Deny specific tools from inherited set  |
| `permissionMode`  | `default`, `acceptEdits`, `dontAsk`, `bypassPermissions`, `plan` | Controls tool approval behavior         |
| `maxTurns`        | Integer                                                          | Max agentic turns before stopping       |
| `skills`          | List of skill names                                              | Preloaded into agent context at startup |
| `mcpServers`      | Server names or inline config                                    | MCP servers available to agent          |
| `hooks`           | PreToolUse, PostToolUse, Stop                                    | Lifecycle hooks scoped to this agent    |
| `memory`          | `user`, `project`, `local`                                       | Persistent memory scope                 |
| `background`      | Boolean                                                          | Run as background task by default       |
| `isolation`       | `worktree`                                                       | Run in isolated git worktree            |

## Description Field

**Syntax:** Single line, `\n` for newlines. Wrap in `'...'` if contains `#` after whitespace.

**Content (brief):**

- What it does (one sentence)
- Required inputs if any
- When to use / when NOT to use
- 1-2 triggering examples

**Do NOT summarize the agent's workflow** in the description — Claude may follow the description shortcut instead of reading the full system prompt.

**Example format:**

```
<example>\nContext: Scenario\nuser: "Request"\nassistant: "Response"\n</example>
```

## Body (System Prompt)

Write in second person ("You are..."). Include:

- Core responsibilities (numbered)
- Step-by-step process
- Output format specification
- Edge case handling

**Guideline:** Aim for 500-3000 characters for focused agents. Extract heavy reference material to separate files or agent memory if the body exceeds this.

## Best Practices

- Specific triggering conditions with examples
- Restrict tools (least privilege)
- Clear output format in body
- Extract large reference tables to files rather than inline

**Avoid:**

- Generic descriptions without examples
- Workflow summaries in description (put in body)
- Vague system prompts
- Duplicating content from project rules the agent inherits

## Template

```yaml
---
name: my-agent
description: 'Does X. Pass Y if known.\n\n**When to use:**\n- Condition\n\n<example>\nContext: User needs X\nuser: "Do X"\nassistant: "Using my-agent for X."\n</example>'
model: sonnet
tools: Read, Bash, Grep, Glob
---

You are an X specialist.

## Responsibilities
1. First task
2. Second task

## Process
1. Analyze input
2. Execute task
3. Return result

## Output Format
- Format specification here
```
