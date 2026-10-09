# GitHub Environments

xfg can create and update **GitHub deployment environments**: the environment itself, which branches and tags can deploy to it, and its secrets.

!!! note "GitHub only"
    Environments only apply to GitHub repos. Azure DevOps and GitLab repos are skipped. Environments on **private** repos need a paid GitHub plan (Pro, Team or Enterprise); on a free plan, private repos are skipped with a warning.

## Quick Start

```yaml
id: my-config

settings:
  environments:
    release:
      deploymentBranchPolicy:
        custom:
          - type: branch
            name: main
          - type: tag
            name: "v*.*.*"
      secrets:
        NPM_TOKEN:
          env: NPM_TOKEN_VALUE

repos:
  - git: git@github.com:your-org/your-repo.git
```

```bash
# Preview changes (dry-run)
xfg sync -c config.yaml --dry-run

# Create the environments and their branch policies
xfg sync -c config.yaml

# Write the environment secrets
xfg secrets sync -c config.yaml
```

`xfg sync` creates and updates environments and branch policies but never touches secrets, so it never needs secret values. Only `xfg secrets sync` writes environment secrets. Run `xfg sync` first: secrets can't be written to an environment that doesn't exist yet.

## Deployment Branch Policy

`deploymentBranchPolicy` controls which refs can deploy to the environment. Use one of these:

| Config                             | Who can deploy                                    |
| ---------------------------------- | ------------------------------------------------- |
| _(omitted)_                        | Any branch                                        |
| `protectedBranches: true`          | Only branches with branch protection rules        |
| `custom: [{ type, name }, ...]`    | Only branches or tags matching the listed patterns |

```yaml
settings:
  environments:
    preview: {}                      # any branch
    staging:
      deploymentBranchPolicy:
        protectedBranches: true
    production:
      deploymentBranchPolicy:
        custom:
          - type: branch
            name: main
          - type: branch
            name: "release/*"
          - type: tag
            name: "v*"
```

Patterns use [fnmatch syntax](https://docs.ruby-lang.org/en/master/File.html#method-c-fnmatch). `type` is `branch` or `tag`.

xfg adds missing patterns. Patterns already on GitHub that are not in your config are **left in place** and reported as a warning:

```text
⚠ your-org/your-repo: environment "production" has branch "hotfix/*" not in config - left in place
```

## Environment Secrets

Environment secrets use the same config as [repo secrets](secrets.md): each entry names the environment variable that holds the value.

```yaml
settings:
  environments:
    release:
      secrets:
        NPM_TOKEN:
          env: NPM_TOKEN_VALUE
```

- Values are encrypted with the environment's own public key and never shown in output.
- Existing secrets always show as `update`, because GitHub never returns secret values.
- Environment secrets have no `deleteOrphaned`: secrets not in config are left alone.
- If an environment doesn't exist yet, `xfg secrets sync --dry-run` still plans its secrets. A real run fails before writing anything on a public repo; on a private repo it skips that environment's secrets with a warning.

## Inheritance

Environments merge by name (ignoring case) through root, groups, conditional groups, and the repo:

- A `deploymentBranchPolicy` set at a lower layer **replaces** the inherited policy as a whole.
- `deploymentBranchPolicy: false` clears an inherited policy, so any branch can deploy. Not allowed at root.
- Secrets merge by name. Set a secret to `false` to drop an inherited one.
- Set an environment to `false` to drop it, or `inherit: false` to drop every inherited environment. `inherit` is not allowed at root.

```yaml
settings:
  environments:
    release:
      deploymentBranchPolicy:
        protectedBranches: true
      secrets:
        NPM_TOKEN: { env: NPM_TOKEN_VALUE }

repos:
  - git: git@github.com:your-org/app.git
    settings:
      environments:
        release:
          deploymentBranchPolicy:
            custom:
              - { type: tag, name: "v*" }   # replaces protectedBranches
          secrets:
            NPM_TOKEN: false               # drop the inherited secret

  - git: git@github.com:your-org/docs.git
    settings:
      environments:
        release: false                     # no release environment here
```

xfg never deletes environments. Removing one from the config leaves it on GitHub.

## Dry Run Output

```text
your-org/your-repo - Environments:
    + environment "release"
        deployment branches: custom
        + branch "main"
        + tag "v*.*.*"
    ~ environment "staging"
        deployment branches: all → protected
  Plan: 2 environments (1 to create, 1 to update)
```

`xfg secrets sync --dry-run` lists environment secrets next to repo secrets:

```text
        + secret "NPM_TOKEN" (environment "release")
        ~ secret "SIGNING_KEY" (environment "release", update, value write-only)
```

## Permissions

- Environments and branch policies: **Administration: Read and write**.
- Environment secrets: **Secrets: Read and write**.

See [GitHub App](../platforms/github-app.md).

## GitHub API Reference

Environments are managed via the [GitHub Deployment Environments API](https://docs.github.com/en/rest/deployments/environments), [Deployment Branch Policies API](https://docs.github.com/en/rest/deployments/branch-policies) and [Actions Secrets API](https://docs.github.com/en/rest/actions/secrets):

- `GET /repos/{owner}/{repo}/environments` — List environments
- `PUT /repos/{owner}/{repo}/environments/{name}` — Create or update an environment's branch policy
- `GET /repos/{owner}/{repo}/environments/{name}/deployment-branch-policies` — List branch and tag patterns
- `POST /repos/{owner}/{repo}/environments/{name}/deployment-branch-policies` — Add a pattern
- `GET /repos/{owner}/{repo}/environments/{name}/secrets` — List environment secrets (names only)
- `GET /repos/{owner}/{repo}/environments/{name}/secrets/public-key` — Get the environment's encryption key
- `PUT /repos/{owner}/{repo}/environments/{name}/secrets/{secret_name}` — Create or update an environment secret
