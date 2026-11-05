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
    Code scanning default setup on **private** and **internal** repositories requires [GitHub Advanced Security (GHAS)](https://docs.github.com/en/get-started/learning-about-github/about-github-advanced-security). **Public repositories** can use code scanning without GHAS.

If GHAS is not enabled for a repository, the code scanning step for that repo fails with `Code scanning default setup requires GitHub Advanced Security (not available for this repository)`. The repo's other settings still apply, and the run exits with a non-zero status. xfg checks this only when `state` is `configured`.

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

Code scanning merges field by field, like the other settings blocks. A repo that sets one field keeps the rest of the inherited block, and some layer must set `state`. A plain `languages` list replaces the inherited one; use `$arrayMerge` to add to it instead. To start from scratch, for example to go back to auto-detected languages, set `inherit: false` in the layer.

When the merged `state` is `not-configured`, `languages` and `querySuite` are dropped: the block is just `state`. A repo can switch code scanning off with `state: not-configured` alone, without `inherit: false`.

```yaml
id: code-scanning
settings:
  codeScanning:
    state: configured
    querySuite: extended
    languages:
      - python
      - go

repos:
  # Keeps state and querySuite, adds a language to the inherited ones
  - git: git@github.com:your-org/web-app.git
    settings:
      codeScanning:
        languages:
          $arrayMerge: append
          $values:
            - javascript-typescript

  # Drops everything inherited, so GitHub auto-detects the languages
  - git: git@github.com:your-org/scripts.git
    settings:
      codeScanning:
        inherit: false
        state: configured
```
