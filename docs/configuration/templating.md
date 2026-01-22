# Templating

Use `${xfg:variable}` syntax to inject repo-specific values into file content. This enables creating templates that automatically adapt to each target repository.

## Enabling Templating

Set `template: true` on a file to enable variable substitution:

```yaml
files:
  README.md:
    template: true
    content: |
      # ${xfg:repo.name}

      Repository: ${xfg:repo.fullName}
      Platform: ${xfg:repo.platform}

repos:
  - git: git@github.com:my-org/backend-service.git
  - git: git@github.com:my-org/frontend-app.git
```

## Built-in Variables

| Variable               | Description        | Example Value                          |
| ---------------------- | ------------------ | -------------------------------------- |
| `${xfg:repo.name}`     | Repository name    | `my-service`                           |
| `${xfg:repo.owner}`    | Owner/organization | `my-org`                               |
| `${xfg:repo.fullName}` | Full repo path     | `my-org/my-service`                    |
| `${xfg:repo.url}`      | Git URL            | `git@github.com:my-org/my-service.git` |
| `${xfg:repo.platform}` | Platform type      | `github`, `azure-devops`, `gitlab`     |
| `${xfg:repo.host}`     | Host domain        | `github.com`                           |
| `${xfg:file.name}`     | Current file name  | `README.md`                            |
| `${xfg:date}`          | Current date       | `2026-01-22`                           |

### Platform-Specific fullName

The `repo.fullName` variable adapts to each platform's conventions:

- **GitHub**: `owner/repo` (e.g., `my-org/backend`)
- **Azure DevOps**: `organization/project/repo` (e.g., `contoso/platform/api`)
- **GitLab**: `namespace/repo` (e.g., `acme/infra/terraform` for nested groups)

## Custom Variables

Define custom variables with the `vars` property:

```yaml
files:
  deploy.yaml:
    template: true
    vars:
      environment: production
      region: us-east-1
    content:
      name: Deploy ${xfg:repo.name}
      env:
        ENVIRONMENT: ${xfg:environment}
        AWS_REGION: ${xfg:region}

repos:
  - git: git@github.com:my-org/api.git
```

### Per-Repo Variable Overrides

Override or add variables for specific repositories:

```yaml
files:
  deploy.yaml:
    template: true
    vars:
      environment: production
    content:
      deployment:
        name: ${xfg:repo.name}
        env: ${xfg:environment}
        region: ${xfg:region}

repos:
  - git: git@github.com:my-org/api.git
    files:
      deploy.yaml:
        vars:
          environment: staging # Override
          region: eu-west-1 # Add new var
```

Per-repo vars merge with root-level vars, with per-repo taking precedence.

## Escaping Variable Syntax

Use `$$` to output literal `${xfg:...}` in the file:

```yaml
files:
  README.md:
    template: true
    content: |
      # ${xfg:repo.name}

      ## Template Syntax

      Use `$${xfg:repo.name}` to reference the repo name.

repos:
  - git: git@github.com:my-org/my-repo.git
```

Output:

```markdown
# my-repo

## Template Syntax

Use `${xfg:repo.name}` to reference the repo name.
```

## Complete Example

````yaml
files:
  # README template with dynamic repo info
  README.md:
    template: true
    content: |
      # ${xfg:repo.name}

      [![Build](https://${xfg:repo.host}/${xfg:repo.fullName}/actions/workflows/ci.yml/badge.svg)](https://${xfg:repo.host}/${xfg:repo.fullName}/actions)

      ## Installation

      ```bash
      npm install @${xfg:repo.owner}/${xfg:repo.name}
      ```

      ## License

      MIT - ${xfg:repo.owner}

  # Package.json with scoped package name
  package.json:
    template: true
    content:
      name: "@${xfg:repo.owner}/${xfg:repo.name}"
      repository:
        type: git
        url: ${xfg:repo.url}
      homepage: "https://${xfg:repo.host}/${xfg:repo.fullName}"

  # CI workflow with environment-specific config
  ".github/workflows/deploy.yml":
    template: true
    vars:
      cluster: main-cluster
    content:
      name: Deploy ${xfg:repo.name}
      on:
        push:
          branches: [main]
      env:
        SERVICE_NAME: ${xfg:repo.name}
        CLUSTER: ${xfg:cluster}

repos:
  - git: git@github.com:acme-corp/user-service.git
  - git: git@github.com:acme-corp/order-service.git
    files:
      ".github/workflows/deploy.yml":
        vars:
          cluster: secondary-cluster # Different cluster for this repo
````

## Combining with Environment Variables

xfg templates and environment variables can be used together. Environment variable interpolation (`${VAR}`) runs during config loading, while xfg templating (`${xfg:...}`) runs during file processing:

```yaml
files:
  config.yaml:
    template: true
    content:
      service: ${xfg:repo.name}
      apiKey: ${API_KEY} # From environment

repos:
  - git: git@github.com:my-org/api.git
```

If you need literal `${...}` syntax in the output for any templating system, escape both:

- `$${VAR}` outputs `${VAR}` (env var syntax)
- `$${xfg:var}` outputs `${xfg:var}` (xfg template syntax)
