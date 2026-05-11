# Merge Strategies

Control how arrays and text lines merge when combining base content with per-repo overlays.

## Strategies

| Strategy  | Behavior                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------- |
| `replace` | Overlay completely replaces base                                                               |
| `append`  | Overlay items added after base items                                                           |
| `prepend` | Overlay items added before base items                                                          |
| `merge`   | Deep-merges array items matched by identity key (`type`, `actor_id`); unmatched items appended |

## File-Level Strategy

Set a default strategy for a file using `mergeStrategy`:

```yaml
files:
  .eslintrc.json:
    mergeStrategy: append # extends arrays will append
    content:
      extends: ["@company/base"]

repos:
  - git: git@github.com:org/frontend.git
    files:
      .eslintrc.json:
        content:
          extends: ["plugin:react/recommended"]
```

Result: `["@company/base", "plugin:react/recommended"]`

## File-Level vs Inline Control

- **File-level `mergeStrategy`**: Sets the default for ALL arrays in that file
- **Inline `$arrayMerge`**: Overrides the strategy for specific arrays within content

Use file-level when all arrays in a file should merge the same way. Use inline `$arrayMerge` when you need per-array control, especially in per-repo overlays.

## Inline Array Merge Directive

For per-field control, use `$arrayMerge` and `$values` directives on individual array fields:

```yaml
files:
  config.json:
    content:
      features: ["core", "monitoring"]

repos:
  - git: git@github.com:org/repo.git
    files:
      config.json:
        content:
          features:
            $arrayMerge: append
            $values: ["custom-feature"]
```

Result: `["core", "monitoring", "custom-feature"]`

### Per-Array Control

Each array field gets its own directive, so sibling arrays can use different strategies:

```yaml
files:
  config.json:
    content:
      features: ["core", "monitoring"]
      tags: ["production"]

repos:
  - git: git@github.com:org/repo.git
    files:
      config.json:
        content:
          features:
            $arrayMerge: append
            $values: ["custom-feature"]
          tags:
            $arrayMerge: prepend
            $values: ["priority"]
```

Result:

- `features`: `["core", "monitoring", "custom-feature"]`
- `tags`: `["priority", "production"]`

### All Strategies

```yaml
# append — add after base items
features:
  $arrayMerge: append
  $values: ["new-item"]
# Base ["a", "b"] + overlay ["c"] = ["a", "b", "c"]

# prepend — add before base items
features:
  $arrayMerge: prepend
  $values: ["new-item"]
# Base ["a", "b"] + overlay ["c"] = ["c", "a", "b"]

# replace — completely replace base (default behavior)
features:
  $arrayMerge: replace
  $values: ["new-item"]
# Base ["a", "b"] + overlay ["c"] = ["c"]

# merge — deep-merge items matched by identity key
rules:
  $arrayMerge: merge
  $values:
    - type: pull_request
      parameters:
        requiredApprovingReviewCount: 2
# Base [{type: "pull_request", parameters: {requiredApprovingReviewCount: 1}}]
# Result: [{type: "pull_request", parameters: {requiredApprovingReviewCount: 2}}]
```

!!! note "Directives are stripped"
    Both `$arrayMerge` and `$values` are internal directives and do not appear in the final output.

### Merge by Key

The `merge` strategy matches array items by an identity key and deep-merges matched pairs. This is useful when multiple conditional groups need to modify properties of the same item rather than duplicating it.

**How it works:**

1. xfg auto-detects the identity key by checking candidates in order: `type`, `actor_id`
1. The first candidate key present in every item of both arrays wins
1. For each overlay item: if a base item shares the same key value, the two are deep-merged; otherwise the overlay item is appended
1. Unmatched base items are preserved in their original position
1. Nested `$arrayMerge` directives inside matched items are honored (deep-merge recurses)

**When no match key is found** (e.g. primitive arrays or objects without `type`/`actor_id`), the strategy falls back to `append` behavior.

```yaml
# Example: merging required_status_checks across conditional groups
settings:
  rulesets:
    pr-rules:
      rules:
        - type: pull_request
          parameters:
            requiredApprovingReviewCount: 1
        - type: required_status_checks
          parameters:
            requiredStatusChecks:
              - context: "ci / build"

conditionalGroups:
  - when:
      allOf: [has-mergify]
    settings:
      rulesets:
        pr-rules:
          rules:
            $arrayMerge: merge
            $values:
              - type: required_status_checks
                parameters:
                  requiredStatusChecks:
                    $arrayMerge: append
                    $values:
                      - context: "mergify / queue"
```

Result for repos with `has-mergify`: the `required_status_checks` rule has both `ci / build` and `mergify / queue` checks — no duplication of the rule itself, and the nested `$arrayMerge: append` adds the check inside the matched item.

## Text File Merge Strategies

For text files with lines array content, merge strategies work the same way:

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
          - "coverage/" # Appended to base
```

Result:

```text
node_modules/
dist/
coverage/
```

!!! note
    String content (not lines array) always uses replace strategy - the entire string is replaced.

## Settings Array Merge

The `$arrayMerge` directive also works in settings overrides — rulesets, bypass actors, rules, conditions, and any other array field. This eliminates duplicating shared entries when a repo needs to add its own items.

### Appending Bypass Actors

```yaml
# Root — shared across all repos
settings:
  rulesets:
    pr-rules:
      bypassActors:
        - actorId: 2740          # Renovate
          actorType: Integration
          bypassMode: always

repos:
  # Adds a repo-specific actor without duplicating Renovate
  - git: git@github.com:org/repo.git
    settings:
      rulesets:
        pr-rules:
          bypassActors:
            $arrayMerge: append
            $values:
              - actorId: 2719952   # repo-specific bot
                actorType: Integration
                bypassMode: always
```

Result: `bypassActors` contains both Renovate (actorId 2740) and the repo-specific bot (actorId 2719952).

### Appending Rules via Conditional Groups

```yaml
settings:
  rulesets:
    pr-rules:
      rules:
        - type: pull_request
          parameters:
            requiredApprovingReviewCount: 1

groups:
  github-ci: {}

conditionalGroups:
  - when:
      allOf: [github-ci]
    settings:
      rulesets:
        pr-rules:
          rules:
            $arrayMerge: append
            $values:
              - type: required_status_checks
                parameters:
                  requiredStatusChecks:
                    - context: "summary / Check Results"
```

Repos with the `github-ci` group get both the `pull_request` rule and the `required_status_checks` rule. Repos without `github-ci` only get the `pull_request` rule.

!!! note "Same syntax as file content"
    The `$arrayMerge` directive uses the same `$arrayMerge` + `$values` syntax in settings as in file content (see Inline Array Merge Directive above). Strategies: `append`, `prepend`, `replace`, `merge`.

## Example: Different Strategies per File

```yaml
files:
  eslint.config.json:
    mergeStrategy: append # Extends will append
    content:
      extends: ["@company/base"]

  tsconfig.json:
    mergeStrategy: replace # Lib will replace entirely
    content:
      compilerOptions:
        lib: ["ES2022"]

repos:
  - git: git@github.com:org/frontend.git
    files:
      eslint.config.json:
        content:
          extends: ["plugin:react/recommended"]
      # Results in extends: ["@company/base", "plugin:react/recommended"]

      tsconfig.json:
        content:
          compilerOptions:
            lib: ["ES2022", "DOM"]
      # Results in lib: ["ES2022", "DOM"] (replaced)
```
