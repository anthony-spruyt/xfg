# IDE Integration

## VS Code YAML Schema Support

For autocomplete and validation in VS Code, install the [YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml) and add a schema reference to your config file.

### Option 1: Inline comment

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/anthony-spruyt/xfg/main/config-schema.json
id: my-config

files:
  my.config.json:
    content:
      key: value

repos:
  - git: git@github.com:org/repo.git
```

### Option 2: VS Code settings

Add to `.vscode/settings.json`:

```json
{
  "yaml.schemas": {
    "https://raw.githubusercontent.com/anthony-spruyt/xfg/main/config-schema.json": [
      "**/sync-config.yaml",
      "**/config-sync.yaml"
    ]
  }
}
```

## What You Get

This enables:

- Autocomplete for all config fields:
  - Root level: `id`, `files`, `groups`, `conditionalGroups`, `repos`, `prOptions`, `prTemplate`, `githubHosts`, `deleteOrphaned`, `settings`
  - File config: `content`, `mergeStrategy`, `createOnly`, `executable`, `header`, `schemaUrl`, `template`, `vars`, `deleteOrphaned`
  - Repo config: `git`, `files`, `groups`, `prOptions`, `settings`, `upstream`, `source`
  - Settings: `rulesets` with full ruleset configuration, `repo`, `labels`, `codeScanning`, `variables`, `secrets`, `collaborators`, `environments`, `deleteOrphaned`
- Enum suggestions for `mergeStrategy` (`replace`, `append`, `prepend`, `merge`), `merge` mode (`manual`, `auto`, `force`, `direct`), etc.
- Validation of field types and allowed values. The schema marks no field as required; xfg itself requires `id` and `repos` when it loads the config
- Hover documentation for each field
