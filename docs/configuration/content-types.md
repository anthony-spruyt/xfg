# Content Types

xfg supports different content types based on the target file extension.

## JSON Files (`.json`)

Object content outputs as JSON with 2-space indentation:

```yaml
files:
  .prettierrc.json:
    content:
      semi: false
      singleQuote: true
```

Output:

```json
{
  "semi": false,
  "singleQuote": true
}
```

## JSON5 Files (`.json5`)

Object content outputs as JSON5 (supports comments, trailing commas):

```yaml
files:
  config.json5:
    content:
      apiUrl: "https://api.example.com"
      timeout: 5000
```

## YAML Files (`.yaml`, `.yml`)

Object content outputs as YAML:

```yaml
files:
  config.yaml:
    content:
      database:
        host: localhost
        port: 5432
```

Output:

```yaml
database:
  host: localhost
  port: 5432
```

### YAML Comments

Add schema directives and header comments to YAML files:

```yaml
files:
  trivy.yaml:
    schemaUrl: https://trivy.dev/latest/docs/references/configuration/config-file/
    header: "Trivy security scanner configuration"
    content:
      exit-code: 1
```

Output:

```yaml
# yaml-language-server: $schema=https://trivy.dev/latest/docs/references/configuration/config-file/
# Trivy security scanner configuration
exit-code: 1
```

Multi-line headers are also supported:

```yaml
files:
  config.yaml:
    header:
      - "Auto-generated configuration"
      - "Do not edit manually"
    content:
      version: 1
```

!!! note
`header` and `schemaUrl` only apply to YAML output files. They are ignored for JSON files.

## Text Files

Files with extensions other than `.json`, `.json5`, `.yaml`, or `.yml` are treated as text files. Use string or string array content:

### String Content

```yaml
files:
  .markdownlintignore:
    content: |-
      # Claude Code generated files
      .claude/
```

### Lines Array Content

```yaml
files:
  .gitignore:
    content:
      - "node_modules/"
      - "dist/"
      - "coverage/"
```

Lines are joined with newlines in the output.

## Empty Files

Omit `content` to create an empty file:

```yaml
files:
  .prettierignore:
    createOnly: true
    # No content = empty file
```

## Validation Rules

- `.json`, `.json5`, `.yaml`, `.yml` files **must** have object content
- Other file extensions **must** have string or string array content
- Mixing content types (e.g., object content in a `.txt` file) causes a validation error
