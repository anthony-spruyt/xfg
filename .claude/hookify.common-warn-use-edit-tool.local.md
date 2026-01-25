---
name: warn-use-edit-tool
enabled: true
event: bash
pattern: (^|\s|&&|\|\||;|\(|`)(sed|awk)\s+.*-i
action: warn
warn_once: true
---

⚠️ **Use the Edit tool instead**

The **Edit tool** is preferred over `sed -i` or `awk -i` for file edits:

- Better security (respects file permission controls)
- Atomic replacements with validation
- Shows clear before/after context
- Supports replace_all for bulk changes

```
Edit(file_path="/path/to/file", old_string="before", new_string="after")
Edit(file_path="/path/to/file", old_string="old", new_string="new", replace_all=true)
```
