# GitHub Collaborators

xfg can add direct collaborators to **personal (user-owned) GitHub repos** with the `sync` command. Use it to make sure a bot account (for example, a CI or ops bot) has access to every repo you manage.

!!! note "Personal repos only"
    Collaborators only apply to repos owned by a user account. Repos owned by an organization are skipped with a warning. Azure DevOps and GitLab repos are skipped.

## Quick Start

```yaml
id: my-config

settings:
  collaborators:
    users:
      - my-bot

repos:
  - git: git@github.com:your-user/your-repo.git
```

```bash
# Preview changes (dry-run)
xfg sync -c config.yaml --dry-run

# Send invites
xfg sync -c config.yaml
```

## How Invites Work

GitHub does not add people to a personal repo straight away. It sends an **invite** that the user must accept.

- A user who is not a collaborator gets an invite (`PUT /repos/{owner}/{repo}/collaborators/{user}`).
- A user with a pending invite is left alone and shown as `invite pending`. xfg does not send it again.
- An expired invite is cancelled and sent again.
- A user who is already a collaborator is left alone.

Personal repos have no permission levels. Collaborators always get write access, so there is no `permission` field.

## Inheritance

Users from root, groups, and the repo are **added together**. Names are matched without caring about case.

```yaml
settings:
  collaborators:
    users:
      - my-bot

repos:
  - git: git@github.com:your-user/foo.git
    settings:
      collaborators:
        users: [other-bot]       # effective: my-bot + other-bot

  - git: git@github.com:your-user/bar.git
    settings:
      collaborators:
        inherit: false           # drop inherited users
        users: [only-this-one]
```

`inherit` is allowed in repos, groups, and conditional groups. It is not allowed at root.

## Removing Collaborators

By default xfg never removes anyone. Turn on `deleteOrphaned` and the `users` list becomes the full list: anyone else is removed.

```yaml
settings:
  collaborators:
    deleteOrphaned: true
    users:
      - my-bot
```

- Direct collaborators not in `users` are removed, including people added by hand.
- Pending invites for people not in `users` are cancelled.
- The repo owner is never removed.
- `--no-delete` turns off removal for that run.

!!! warning
    With `deleteOrphaned: true`, an empty or missing `users` list removes every collaborator except the owner.

## Dry Run Output

```text
your-user/foo - Collaborators:
  Invite:
    + collaborator "other-bot" (invite)

  Remove:
    - collaborator "old-bot"

    collaborator "my-bot": invite pending
  Plan: 2 collaborators (1 to invite, 1 to remove)
```

## GitHub API Reference

Collaborators are managed via the [GitHub Collaborators API](https://docs.github.com/en/rest/collaborators):

- `GET /repos/{owner}/{repo}/collaborators?affiliation=direct` — List direct collaborators
- `GET /repos/{owner}/{repo}/invitations` — List pending invites
- `PUT /repos/{owner}/{repo}/collaborators/{username}` — Invite a user
- `DELETE /repos/{owner}/{repo}/collaborators/{username}` — Remove a collaborator
- `DELETE /repos/{owner}/{repo}/invitations/{invitation_id}` — Cancel an invite
