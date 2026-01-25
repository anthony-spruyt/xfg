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

| Strategy  | Behavior                                   |
| --------- | ------------------------------------------ |
| `replace` | Overlay completely replaces base (default) |
| `append`  | Overlay items added after base items       |
| `prepend` | Overlay items added before base items      |

## Inline `$arrayMerge` Directive

For per-repo array control without setting a file-level strategy, use the `$arrayMerge` directive within content.

### Wrapped Syntax

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
            values: ["tracing", "rate-limiting"]

  # Data team - prepend their plugin
  - git: git@github.com:org/data-pipeline.git
    files:
      service.config.json:
        content:
          plugins:
            $arrayMerge: prepend
            values: ["data-transform"]
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

### Sibling Syntax

Use `$arrayMerge` as a sibling key to apply the strategy to all arrays in that object:

```yaml
id: my-org-config
files:
  config.json:
    content:
      features: ["core"]
      tags: ["standard"]

repos:
  - git: git@github.com:org/repo.git
    files:
      config.json:
        content:
          $arrayMerge: append
          features: ["custom"]
          tags: ["team-a"]
```

**Result** (both arrays appended):

```json
{
  "features": ["core", "custom"],
  "tags": ["standard", "team-a"]
}
```
