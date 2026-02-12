# IDE Integration

## VS Code YAML Schema Support

For autocomplete and validation in VS Code, install the [YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml) and add a schema reference to your config file.

### Option 1: Inline comment

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/anthony-spruyt/xfg/main/config-schema.json
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
  - Root level: `id`, `files`, `repos`, `settings`, `prOptions`, `prTemplate`, `githubHosts`, `deleteOrphaned`
  - File config: `content`, `mergeStrategy`, `createOnly`, `executable`, `header`, `schemaUrl`, `template`, `vars`, `deleteOrphaned`
  - Repo config: `git`, `files`, `settings`, `prOptions`
  - Settings: `repo`, `rulesets` with full ruleset configuration
- Enum suggestions for `mergeStrategy` (`replace`, `append`, `prepend`), `merge` mode (`manual`, `auto`, `force`, `direct`), etc.
- Validation of required fields (`id`, `repos`)
- Hover documentation for each field
