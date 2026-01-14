# Shared hookify implementation
# Copied from https://github.com/anthropics/claude-plugins-official/tree/19a119f9/plugins/hookify
# Used by native hook bridge and tests

from .config_loader import Rule, Condition, load_rules, load_rule_file, extract_frontmatter
from .rule_engine import RuleEngine
