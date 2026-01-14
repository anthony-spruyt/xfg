---
name: warn-use-glob-tool
enabled: false
event: bash
pattern: (^|\s|&&|\|\||;|\(|`)(find|ls)\s+\S
action: warn
---

⚠️ **Use the Glob tool instead**

The **Glob tool** is preferred over `find` and `ls` for file searches:

- Better security (respects file permission controls)
- Fast pattern matching for any codebase size
- Results sorted by modification time
- Cleaner output for file discovery

```
Glob(pattern="**/*.ts")
Glob(pattern="src/**/*.test.js")
Glob(pattern="*.md", path="./docs")
```
