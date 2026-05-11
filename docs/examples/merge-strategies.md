# Per-File Merge Strategies

Different files can use different array merge strategies.

## Example

```yaml
id: my-org-config
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

      tsconfig.json:
        content:
          compilerOptions:
            lib: ["ES2022", "DOM"]
```

## Results

**eslint.config.json** (append strategy):

```json
{
  "extends": ["@company/base", "plugin:react/recommended"]
}
```

**tsconfig.json** (replace strategy):

```json
{
  "compilerOptions": {
    "lib": ["ES2022", "DOM"]
  }
}
```

## Available Strategies

| Strategy  | Behavior                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------- |
| `replace` | Overlay completely replaces base (default)                                                     |
| `append`  | Overlay items added after base items                                                           |
| `prepend` | Overlay items added before base items                                                          |
| `merge`   | Deep-merges array items matched by identity key (`type`, `actor_id`); unmatched items appended |

## Inline `$arrayMerge` Directive

For per-repo array control without setting a file-level strategy, use the `$arrayMerge` directive within content.

```yaml
id: my-org-config
files:
  service.config.json:
    content:
      features: ["health-check", "metrics"]
      plugins: ["auth"]

repos:
  # Platform team - append extra features
  - git: git@github.com:org/api-gateway.git
    files:
      service.config.json:
        content:
          features:
            $arrayMerge: append
            $values: ["tracing", "rate-limiting"]

  # Data team - prepend their plugin
  - git: git@github.com:org/data-pipeline.git
    files:
      service.config.json:
        content:
          plugins:
            $arrayMerge: prepend
            $values: ["data-transform"]
```

**api-gateway result:**

```json
{
  "features": ["health-check", "metrics", "tracing", "rate-limiting"],
  "plugins": ["auth"]
}
```

**data-pipeline result:**

```json
{
  "features": ["health-check", "metrics"],
  "plugins": ["data-transform", "auth"]
}
```

### Per-Array Control

Each array field specifies its own `$arrayMerge` + `$values`, so sibling arrays can use different strategies independently.

## Merge by Key

The `merge` strategy matches items by identity key and deep-merges matched pairs. This avoids duplicating items when multiple conditional groups modify the same entry.

```yaml
id: my-org-config
settings:
  rulesets:
    branch-protection:
      rules:
        - type: pull_request
          parameters:
            requiredApprovingReviewCount: 1
            dismissStaleReviewsOnPush: true
        - type: required_status_checks
          parameters:
            requiredStatusChecks:
              - context: "ci / build"

conditionalGroups:
  - when:
      allOf: [has-mergify]
    settings:
      rulesets:
        branch-protection:
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

**Result for repos with `has-mergify`:**

The `required_status_checks` rule is matched by `type` and deep-merged — no duplicate rule entry. The nested `$arrayMerge: append` adds the extra check:

```json
{
  "rules": [
    {
      "type": "pull_request",
      "parameters": {
        "requiredApprovingReviewCount": 1,
        "dismissStaleReviewsOnPush": true
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "requiredStatusChecks": [
          { "context": "ci / build" },
          { "context": "mergify / queue" }
        ]
      }
    }
  ]
}
```
