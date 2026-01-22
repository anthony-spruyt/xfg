# Per-File Merge Strategies

Different files can use different array merge strategies.

## Example

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
