---
name: warn-use-read-tool
enabled: false
event: bash
pattern: (^|\s|&&|\|\||;|\(|`)(cat|head|tail|less|more)\s+[^|]
action: warn
---

⚠️ **Use the Read tool instead**

The **Read tool** is preferred over `cat`, `head`, `tail` for reading files:

- Better security (respects file permission controls)
- Shows line numbers automatically
- Supports offset/limit for large files
- Works with images and PDFs

```
Read(file_path="/path/to/file")
Read(file_path="/path/to/file", offset=100, limit=50)
```
