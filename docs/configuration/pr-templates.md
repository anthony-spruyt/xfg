# PR Templates

Customize the PR body with a template using `${xfg:...}` variables.

## Basic Usage

```yaml
prTemplate: |
  ## Configuration Update

  This PR synchronizes files to ${xfg:repo.fullName}:

  ${xfg:pr.fileChanges}

  Please review and merge.

files:
  .prettierrc.json:
    content:
      semi: false

repos:
  - git: git@github.com:org/repo.git
```

## External Template File

Reference an external file for larger templates:

```yaml
prTemplate: "@templates/pr-body.md"

files:
  # ...

repos:
  # ...
```

## Available Variables

PR templates support all [templating variables](templating.md), plus PR-specific variables:

| Variable                | Description                         | Example Output                                           |
| ----------------------- | ----------------------------------- | -------------------------------------------------------- |
| `${xfg:pr.fileChanges}` | Bulleted list of files with actions | `- Created \`config.json\`\n- Updated \`settings.yaml\`` |
| `${xfg:pr.fileCount}`   | Number of changed files             | `3`                                                      |
| `${xfg:pr.title}`       | The generated PR title              | `chore: sync config.json, settings.yaml`                 |
| `${xfg:repo.name}`      | Repository name                     | `my-repo`                                                |
| `${xfg:repo.owner}`     | Repository owner                    | `my-org`                                                 |
| `${xfg:repo.fullName}`  | Full repository path                | `my-org/my-repo`                                         |
| `${xfg:repo.platform}`  | Platform type                       | `github`, `azure-devops`, `gitlab`                       |

## Default Template

If `prTemplate` is not specified, xfg uses a built-in template:

```markdown
## Summary

Automated sync of configuration files to ${xfg:repo.fullName}.

## Changes

${xfg:pr.fileChanges}

## Source

Configuration synced using [xfg](https://github.com/anthony-spruyt/xfg).
```

## Example Template

```markdown
## Summary

Automated configuration sync to ${xfg:repo.fullName}.

## Changes (${xfg:pr.fileCount} files)

${xfg:pr.fileChanges}

## Notes

- Review changes before merging
- Contact @platform-team with questions
```
