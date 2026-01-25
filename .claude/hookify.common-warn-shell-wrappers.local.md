---
name: warn-shell-wrappers
enabled: true
event: bash
pattern: (^|\s|&&|\|\||;)(sh|bash|dash|zsh)\s+-c\s|(\s|^)eval\s
action: warn
warn_once: true
---

⚠️ **Consider using dedicated tools instead**

Shell wrappers (`sh -c`, `bash -c`, `eval`) bypass security controls.

| Instead of...              | Use...                        |
| -------------------------- | ----------------------------- |
| `sh -c 'cat file'`         | **Read tool** for file access |
| `bash -c 'grep pattern'`   | **Grep tool** for searching   |
| `eval "sed 's/a/b/' file"` | **Edit tool** for edits       |
| `sh -c 'command'`          | **Bash tool** directly        |
