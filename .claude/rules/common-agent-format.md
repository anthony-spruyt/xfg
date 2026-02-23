---
paths: [.claude/agents/*.md]
---

# Agent File Format

## Frontmatter (required)

| Field         | Format                       | Notes               |
| ------------- | ---------------------------- | ------------------- |
| `name`        | lowercase-hyphen, 3-50 chars | Identifier          |
| `description` | Single line with `\n`        | Triggers + examples |
| `model`       | opus, sonnet, haiku          | Or omit to inherit  |

Optional: `color` (blue/cyan/green/yellow/magenta/red), `tools` (array)

## Description Field

**Syntax:** Single line, `\n` for newlines. Wrap in `'...'` if contains `#` after whitespace.

**Content (brief):**

- What it does (one sentence)
- Required inputs if any
- When to use / when NOT to use
- 1-2 triggering examples

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

Keep 500-3000 characters for clarity.

## Best Practices

✅ Specific triggering conditions with examples
✅ Restrict tools (least privilege)
✅ Clear output format in body

❌ Generic descriptions without examples
❌ Implementation details in description
❌ Vague system prompts

## Template

```yaml
---
name: my-agent
description: 'Does X. Pass Y if known.\n\n**When to use:**\n- Condition\n\n<example>\nContext: User needs X\nuser: "Do X"\nassistant: "Using my-agent for X."\n</example>'
model: sonnet
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
