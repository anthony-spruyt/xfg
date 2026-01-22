# Merge Strategies

Control how arrays and text lines merge when combining base content with per-repo overlays.

## Strategies

| Strategy  | Behavior                              |
| --------- | ------------------------------------- |
| `replace` | Overlay completely replaces base      |
| `append`  | Overlay items added after base items  |
| `prepend` | Overlay items added before base items |

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

## Inline Array Merge Directive

For more granular control, use the `$arrayMerge` directive within the content:

```yaml
files:
  config.json:
    content:
      features:
        - core
        - monitoring

repos:
  - git: git@github.com:org/repo.git
    files:
      config.json:
        content:
          features:
            $arrayMerge: append
            values:
              - custom-feature
```

Result: `["core", "monitoring", "custom-feature"]`

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

```
node_modules/
dist/
coverage/
```

!!! note
String content (not lines array) always uses replace strategy - the entire string is replaced.

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
