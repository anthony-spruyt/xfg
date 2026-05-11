# Code Scanning

xfg can manage GitHub code scanning default setup declaratively using the `sync` command. Configure code scanning analysis across repositories to ensure consistent security scanning coverage.

!!! note "GitHub-Only Feature"
    Code scanning is only available for GitHub repositories. Azure DevOps and GitLab repos will be skipped when running `xfg sync`.

## Quick Start

```yaml
id: my-config

settings:
  codeScanning:
    state: configured
    querySuite: extended

repos:
  - git: git@github.com:your-org/your-repo.git
```

```bash
# Preview changes (dry-run)
xfg sync -c config.yaml --dry-run

# Apply code scanning settings
xfg sync -c config.yaml
```

## Configuration Fields

| Property     | Required | Description                                                                                   |
| ------------ | -------- | --------------------------------------------------------------------------------------------- |
| `state`      | Yes      | `configured` to enable code scanning, `not-configured` to disable                             |
| `querySuite` | No       | `default` for standard queries, `extended` for additional queries. Omit to let GitHub decide. |
| `languages`  | No       | Array of languages to analyze. Omit to let GitHub auto-detect languages in the repository.    |

## Supported Languages

| Language                | Value                   |
| ----------------------- | ----------------------- |
| GitHub Actions          | `actions`               |
| C / C++                 | `c-cpp`                 |
| C#                      | `csharp`                |
| Go                      | `go`                    |
| Java / Kotlin           | `java-kotlin`           |
| JavaScript / TypeScript | `javascript-typescript` |
| Python                  | `python`                |
| Ruby                    | `ruby`                  |
| Swift                   | `swift`                 |

## Full Example

```yaml
id: org-security

settings:
  codeScanning:
    state: configured
    querySuite: extended
    languages:
      - javascript-typescript
      - python
      - go

repos:
  - git: git@github.com:your-org/api-service.git
  - git: git@github.com:your-org/web-app.git
  - git: git@github.com:your-org/cli-tool.git
    settings:
      codeScanning:
        state: configured
        querySuite: default  # Override: use default queries for this repo
```

## GitHub Advanced Security Requirement

!!! warning "Private and Internal Repositories"
    Code scanning default setup on **private** and **internal** repositories requires [GitHub Advanced Security (GHAS)](https://docs.github.com/en/get-started/learning-about-github/about-github-advanced-security). If GHAS is not enabled for a repository, xfg will report an error and skip that repo. **Public repositories** can use code scanning without GHAS.

## Per-Repo Opt-Out

To exclude a specific repository from inherited code scanning settings, set `codeScanning: false` at the repo level:

```yaml
id: my-config

settings:
  codeScanning:
    state: configured
    querySuite: extended

repos:
  - git: git@github.com:your-org/main-app.git
  - git: git@github.com:your-org/legacy-app.git
    settings:
      codeScanning: false  # Opt out of code scanning for this repo
```

## Override Behavior

Per-repo code scanning settings **fully replace** the root settings (not shallow merge). This means if a repo overrides `querySuite`, it does not inherit `languages` from the root — you must specify all desired fields:

```yaml
settings:
  codeScanning:
    state: configured
    querySuite: extended
    languages:
      - python
      - go

repos:
  - git: git@github.com:your-org/web-app.git
    settings:
      codeScanning:
        state: configured
        querySuite: default
        # Must re-specify languages if you want them
        languages:
          - javascript-typescript
```
