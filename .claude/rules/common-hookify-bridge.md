---
paths: .claude/hookify.*.local.md, .claude/hooks/**, .claude/lib/common_hookify/**, tests/hooks/**
---

# Hookify Bridge Workaround

## The Problem

The hookify plugin has a bug ([#12446](https://github.com/anthropics/claude-code/issues/12446)) where blocking/warning messages only reach the user, not Claude. This means Claude doesn't know why a command was blocked.

## The Solution

A native hook bridge at `.claude/hooks/common-hookify-bridge.py` processes hookify rules with proper feedback to Claude via stderr + exit 2.

## Key Points

1. **All hookify rules have `enabled: false`** - The hookify plugin skips them
2. **Bridge loads disabled rules** - Only rules with `bridgeEnabled: true` (default)
3. **Tests need `include_disabled=True`** - Otherwise `load_rules()` returns empty

## When Modifying Hookify Rules

```yaml
---
name: my-rule
enabled: false # Required: plugin skips, bridge handles
bridgeEnabled: true # Optional: defaults to true
event: bash
pattern: dangerous-command
action: block
---
```

To truly disable a rule, set both `enabled: false` AND `bridgeEnabled: false`.

## When Modifying Tests

Always use `include_disabled=True`:

```python
rules = load_rules(event='bash', rules_dir='.claude', include_disabled=True)
```

## When #12446 is Fixed

Set `enabled: true` on rules to switch back to hookify plugin handling.
