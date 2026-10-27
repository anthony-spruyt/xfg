# PR Templates

Customize the PR body with a template using `${xfg:...}` variables.

## Basic Usage

```yaml
id: pr-templates
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

<!-- docs-example: skip -->

```yaml
id: pr-templates
prTemplate: "@templates/pr-body.md"

files:
  # ...

repos:
  # ...
```

## Available Variables

PR templates support all [templating variables](templating.md), plus PR-specific variables:

| Variable                | Description                                                       | Example Output                                             |
| ----------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------- |
| `${xfg:pr.fileChanges}` | Bulleted list of files with actions                               | `- Created \`config.json\`\\n- Updated \`settings.yaml\`\` |
| `${xfg:pr.fileCount}`   | Number of changed files                                           | `3`                                                        |
| `${xfg:pr.title}`       | The PR title. The [AI subject](ai-messages.md) when AI is on      | `chore: sync config.json, settings.yaml`                   |
| `${xfg:pr.aiSummary}`   | [AI summary](ai-messages.md) of the changes. Empty when AI is off | `Pins actions/checkout to v5.`                             |
| `${xfg:repo.name}`      | Repository name                                                   | `my-repo`                                                  |
| `${xfg:repo.owner}`     | Repository owner                                                  | `my-org`                                                   |
| `${xfg:repo.fullName}`  | Full repository path                                              | `my-org/my-repo`                                           |
| `${xfg:repo.platform}`  | Platform type                                                     | `github`, `azure-devops`, `gitlab`                         |

## Default Template

If `prTemplate` is not specified, xfg uses the [`PR.md`](https://github.com/anthony-spruyt/xfg/blob/main/packages/xfg/PR.md) template shipped in the package.

When [AI commit messages](ai-messages.md) are on and a custom template does not use `${xfg:pr.aiSummary}`, the summary is appended at the end under `## AI Summary`.

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
