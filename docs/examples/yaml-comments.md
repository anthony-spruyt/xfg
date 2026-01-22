# YAML Comments & Empty Files

Add schema directives and comments to YAML files, or create empty files.

## Schema Directive

```yaml
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
    - vuln
```

## Header Comment

```yaml
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

## Empty Files

Omit `content` to create an empty file:

```yaml
files:
  .prettierignore:
    createOnly: true
    # No content = empty file

repos:
  - git: git@github.com:org/repo.git
```

!!! note
`header` and `schemaUrl` only apply to YAML output files (`.yaml`, `.yml`). They are ignored for JSON files.
