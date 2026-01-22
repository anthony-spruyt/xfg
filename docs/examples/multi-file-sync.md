# Multi-File Sync

Sync multiple configuration files to all repos in a single run.

## Example

```yaml
files:
  .eslintrc.json:
    content:
      extends: ["@org/eslint-config"]
      rules:
        no-console: warn

  .prettierrc.yaml:
    content:
      semi: false
      singleQuote: true

  tsconfig.json:
    content:
      compilerOptions:
        strict: true
        target: ES2022

repos:
  - git:
      - git@github.com:org/frontend.git
      - git@github.com:org/backend.git
      - git@github.com:org/shared-lib.git
```

## Result

Each repository receives:

- `.eslintrc.json` - ESLint configuration (JSON format)
- `.prettierrc.yaml` - Prettier configuration (YAML format)
- `tsconfig.json` - TypeScript configuration (JSON format)

A single PR is created in each repo containing all three files.
