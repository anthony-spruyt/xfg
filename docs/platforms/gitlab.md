# GitLab

## URL Formats

### GitLab.com (SaaS)

| Format | Example                             |
| ------ | ----------------------------------- |
| SSH    | `git@gitlab.com:owner/repo.git`     |
| HTTPS  | `https://gitlab.com/owner/repo.git` |

### Nested Groups

GitLab supports nested groups in the path:

```
git@gitlab.com:org/group/subgroup/repo.git
```

### Self-Hosted Instances

| Format | Example                                     |
| ------ | ------------------------------------------- |
| SSH    | `git@gitlab.example.com:owner/repo.git`     |
| HTTPS  | `https://gitlab.example.com/owner/repo.git` |

## Authentication

### GitLab.com

```bash
glab auth login
```

### Self-Hosted

```bash
glab auth login --hostname gitlab.example.com
```

## Required Permissions

The user needs at least "Developer" role on the project.

## Merge Request Handling

| Merge Mode | GitLab Behavior                                                         |
| ---------- | ----------------------------------------------------------------------- |
| `manual`   | Leave MR open for review                                                |
| `auto`     | Merge when pipeline succeeds (`glab mr merge --when-pipeline-succeeds`) |
| `force`    | Merge immediately (`glab mr merge -y`)                                  |

## MR Creation

xfg uses the `glab` CLI to:

1. Create the merge request with `glab mr create`
2. Configure merge behavior based on `prOptions`
