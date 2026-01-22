# PR Templates

Customize the PR body with a template.

## Basic Usage

```yaml
prTemplate: |
  ## Configuration Update

  This PR synchronizes the following files:

  {{FILE_CHANGES}}

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

## Available Placeholders

| Placeholder        | Description                         | Example Output                                           |
| ------------------ | ----------------------------------- | -------------------------------------------------------- |
| `{{FILE_CHANGES}}` | Bulleted list of files with actions | `- Created \`config.json\`\n- Updated \`settings.yaml\`` |

## Default Template

If `prTemplate` is not specified, xfg uses a built-in template with:

- Summary section
- Changes section (list of files)
- Source information

## Example Template

```markdown
## Summary

Automated configuration sync from the central config repository.

## Changes

{{FILE_CHANGES}}

## Notes

- Review changes before merging
- Contact @platform-team with questions
```
