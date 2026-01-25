---
name: warn-use-grep-tool
enabled: true
event: bash
pattern: (^|\s|&&|\|\||;|\(|`)(grep|rg|ack|ag)\s
action: warn
warn_once: true
---

⚠️ **Use the Grep tool instead**

The **Grep tool** is preferred over `grep`, `rg`, `ack`, `ag`:

- Better security (respects file permission controls)
- Optimized for codebase search
- Multiple output modes (content, files, count)
- Supports context lines (-A, -B, -C)

```
Grep(pattern="search term", path="./src")
Grep(pattern="function\\s+\\w+", glob="*.js", output_mode="content")
```
