# YAML Comments & Empty Files

Add schema directives and comments to YAML files, or create empty files.

## Schema Directive

```yaml
id: my-org-config
files:
  trivy.yaml:
    schemaUrl: https://trivy.dev/latest/docs/references/configuration/config-file/
    content:
      exit-code: 1
      scan:
        scanners:
          - vuln

repos:
  - git: git@github.com:org/repo.git
```

**Output:**

```yaml
# yaml-language-server: $schema=https://trivy.dev/latest/docs/references/configuration/config-file/

exit-code: 1
scan:
  scanners:
    - "vuln"
```

## Header Comment

```yaml
id: my-org-config
files:
  trivy.yaml:
    schemaUrl: https://trivy.dev/latest/docs/references/configuration/config-file/
    header: "Trivy security scanner configuration"
    content:
      exit-code: 1

repos:
  - git: git@github.com:org/repo.git
```

**Output:**

```yaml
# yaml-language-server: $schema=https://trivy.dev/latest/docs/references/configuration/config-file/
# Trivy security scanner configuration

exit-code: 1
```

## Multi-Line Header

```yaml
id: my-org-config
files:
  config.yaml:
    header:
      - "Auto-generated configuration"
      - "Do not edit manually"
    content:
      version: 1

repos:
  - git: git@github.com:org/repo.git
```

**Output:**

```yaml
# Auto-generated configuration
# Do not edit manually

version: 1
```

## JSON5 Header

`.json5` files take `header` as `//` comment lines. `schemaUrl` has no effect on them.

```yaml
id: my-org-config
files:
  .prettierrc.json5:
    header: "Auto-generated - do not edit"
    content:
      semi: false

repos:
  - git: git@github.com:org/repo.git
```

**Output:**

```text
// Auto-generated - do not edit
{
  "semi": false
}
```

## Empty Files

Omit `content` to create an empty file:

```yaml
id: my-org-config
files:
  .prettierignore:
    createOnly: true
    # No content = empty file

repos:
  - git: git@github.com:org/repo.git
```

!!! note
    `header` applies to YAML output files (`.yaml`, `.yml`) as `#` comment lines and to `.json5` files as `//` comment lines. `schemaUrl` applies to YAML output files only. Both are ignored for `.json` files.
