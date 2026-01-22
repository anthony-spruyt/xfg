# Text Files

Sync text files like `.gitignore`, `.markdownlintignore`, or `.env.example` using string or lines array content.

## String Content (Multiline Text)

```yaml
files:
  .markdownlintignore:
    createOnly: true
    content: |-
      # Claude Code generated files
      .claude/

repos:
  - git: git@github.com:org/repo.git
```

**Output:**

```
# Claude Code generated files
.claude/
```

## Lines Array with Merge Strategy

```yaml
files:
  .gitignore:
    mergeStrategy: append
    content:
      - "node_modules/"
      - "dist/"

repos:
  - git: git@github.com:org/repo.git
    files:
      .gitignore:
        content:
          - "coverage/" # Appended to base lines

  - git: git@github.com:org/another-repo.git
    files:
      .gitignore:
        content:
          - ".env.local" # Appended to base lines
```

**Result for first repo:**

```
node_modules/
dist/
coverage/
```

## Content Types Summary

| Type        | Syntax                              | Merge Behavior                  |
| ----------- | ----------------------------------- | ------------------------------- |
| String      | `content: \|-` or `content: "text"` | Always replaces (no merge)      |
| Lines array | `content: ["line1", "line2"]`       | Supports append/prepend/replace |

## Validation Rules

- `.json`, `.json5`, `.yaml`, `.yml` files must have object content
- Other file extensions must have string or string[] content
