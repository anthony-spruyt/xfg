#!/usr/bin/env python3
"""
Native hook bridge for hookify rules.

Loads hookify rules and applies them with proper feedback to Claude
(via stderr + exit 2 for block).

For warnings, use --post flag (PostToolUse) to show after command runs.

Workaround for: https://github.com/anthropics/claude-code/issues/12446
"""

import glob
import json
import sys
from pathlib import Path

# Check if running as PostToolUse (warnings only)
POST_MODE = "--post" in sys.argv

# =============================================================================
# CONFIGURATION
# =============================================================================

# When True: only load rules with `enabled: false` (hookify handles enabled ones)
# When False: load all rules regardless of enabled flag (hookify should be disabled)
DISABLED_ONLY = True

# =============================================================================

# Add .claude/lib to path for shared hookify module
CLAUDE_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(CLAUDE_DIR / "lib"))

from common_hookify import load_rules, load_rule_file, RuleEngine


def load_bridge_rules(rules_dir: Path, event: str):
    """Load rules for bridge to handle.

    Rules are included if:
    - enabled: false (so hookify skips them)
    - bridgeEnabled: true (so bridge handles them)

    To truly disable a rule, set both enabled: false and bridgeEnabled: false.
    """
    rules = []
    pattern = str(rules_dir / "hookify.*.local.md")

    for file_path in glob.glob(pattern):
        rule = load_rule_file(file_path)
        if not rule:
            continue

        if rule.enabled:
            continue  # Skip enabled rules (hookify handles those)
        if not rule.bridge_enabled:
            continue  # Skip truly disabled rules
        if rule.event != "all" and rule.event != event:
            continue

        rules.append(rule)

    return rules


def main():
    # Read tool input from stdin
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        sys.exit(0)

    # Build hook input format expected by hookify
    tool_name = input_data.get("tool_name", "Bash")
    hook_input = {
        "hook_event_name": "PreToolUse",
        "tool_name": tool_name,
        "tool_input": input_data.get("tool_input", {}),
    }

    # Determine event type based on tool
    event = "file" if tool_name == "Read" else "bash"

    # Load rules from .claude directory
    claude_dir = CLAUDE_DIR

    if DISABLED_ONLY:
        # Only load disabled rules (hookify plugin handles enabled ones)
        rules = load_bridge_rules(claude_dir, event=event)
    else:
        # Load all enabled rules (hookify plugin should be disabled)
        rules = load_rules(event=event, rules_dir=str(claude_dir))

    # Evaluate rules
    engine = RuleEngine()
    result = engine.evaluate_rules(rules, hook_input)

    is_block = result.get("hookSpecificOutput", {}).get("permissionDecision") == "deny"
    is_warn = result.get("systemMessage") and not result.get("hookSpecificOutput")

    def show_block_to_user(message: str):
        """Show block message to user - try /dev/tty (CLI), fall back to stdout (extension)."""
        try:
            with open("/dev/tty", "w") as tty:
                tty.write(f"\n🚫 BLOCKED: {message}\n")
        except (OSError, IOError):
            print(f"🚫 BLOCKED: {message}")  # stdout fallback for extension

    if POST_MODE:
        # PostToolUse: warnings for Claude only (user can see via ctrl+o if curious)
        if is_warn:
            message = result.get("systemMessage")
            print(message, file=sys.stderr)  # stderr for Claude
            sys.exit(2)
        sys.exit(0)
    else:
        # PreToolUse: blocks shown to both user and Claude
        if is_block:
            message = result.get("systemMessage", "Blocked by hookify rule")
            show_block_to_user(message)
            print(message, file=sys.stderr)  # stderr for Claude
            sys.exit(2)
        sys.exit(0)


if __name__ == "__main__":
    main()
