# Groups

Groups let you define shared configuration layers between the root config and per-repo overrides. Repos reference groups by name via `groups: [...]`, creating a merge chain: **root → group1 → group2 → repo overrides**.

## Basic Usage

```yaml
id: my-config
files:
  base.json:
    content:
      version: "2.0"

groups:
  frontend:
    files:
      eslint.json:
        content:
          extends: ["@company/frontend"]
      base.json:
        content:
          framework: react

  backend:
    files:
      base.json:
        content:
          runtime: node

repos:
  - git: git@github.com:org/web-app.git
    groups: [frontend]

  - git: git@github.com:org/api-service.git
    groups: [backend]
```

- `web-app` gets `base.json` (merged root + frontend group) and `eslint.json` (from frontend group)
- `api-service` gets `base.json` (merged root + backend group)

## Group Fields

Groups support the same override capabilities as repos:

| Field        | Description                                           |
| ------------ | ----------------------------------------------------- |
| `files`      | File definitions or overrides (same syntax as repos)  |
| `prOptions`  | PR merge options (merged into chain)                  |
| `settings`   | Repository settings like rulesets, labels             |

## Merge Chain

When a repo references groups, the merge chain is:

1. **Root files** — base layer
2. **Group layers** — applied left-to-right in array order
3. **Repo overrides** — final layer

Each layer deep-merges onto the previous. Later values win for conflicting keys.

## Multiple Groups

Repos can reference multiple groups. They are applied in order — later groups override earlier ones:

```yaml
groups:
  base-tooling:
    files:
      config.json:
        content:
          lint: true
          format: true

  strict-tooling:
    files:
      config.json:
        content:
          strict: true
          lint: false  # Overrides base-tooling

repos:
  - git: git@github.com:org/repo.git
    groups: [base-tooling, strict-tooling]
    # Result: { lint: false, format: true, strict: true }
```

## File Exclusion in Groups

### `file: false` — Remove a file

A group can remove a root file from the accumulated set:

```yaml
files:
  eslint.json:
    content: { extends: ["base"] }
  prettier.json:
    content: { semi: false }

groups:
  no-prettier:
    files:
      prettier.json: false  # Remove prettier from repos using this group

repos:
  - git: git@github.com:org/repo.git
    groups: [no-prettier]
    # Gets eslint.json only
```

### `inherit: false` — Discard all accumulated files

A group can discard all files from previous layers:

```yaml
files:
  base.json:
    content: { key: value }

groups:
  fresh-start:
    files:
      inherit: false
      custom.json:
        content: { custom: true }

repos:
  - git: git@github.com:org/repo.git
    groups: [fresh-start]
    # Gets custom.json only — base.json is discarded
```

### Repo-level `inherit: false`

When a repo uses `inherit: false` on its files, both root and group files are discarded:

```yaml
groups:
  mygroup:
    files:
      group.json:
        content: { fromGroup: true }

repos:
  - git: git@github.com:org/repo.git
    groups: [mygroup]
    files:
      inherit: false
      # No files — root and group files are all discarded
```

## `override: true` at Group Level

Use `override: true` in a group file to replace content entirely instead of deep-merging:

```yaml
files:
  config.json:
    content:
      fromRoot: true
      shared: root-value

groups:
  mygroup:
    files:
      config.json:
        override: true
        content:
          fromGroup: true
    # Result: { fromGroup: true } — root content is replaced
```

## Group Settings

Groups can define settings (rulesets, labels, repo settings) that merge into the chain:

```yaml
settings:
  rulesets:
    base-protection:
      target: branch
      enforcement: active

groups:
  strict:
    settings:
      rulesets:
        strict-reviews:
          target: branch
          enforcement: active
          rules:
            pull_request:
              required_approving_review_count: 2

repos:
  - git: git@github.com:org/repo.git
    groups: [strict]
    # Gets both base-protection and strict-reviews rulesets
```

### `inherit: false` on Group Settings

Groups can discard accumulated rulesets or labels:

```yaml
groups:
  custom-rules:
    settings:
      rulesets:
        inherit: false  # Discard root rulesets
        custom-protection:
          target: branch
          enforcement: active
```

## Group PR Options

Groups can set PR options that merge into the chain:

```yaml
prOptions:
  merge: auto

groups:
  labeled:
    prOptions:
      labels: [from-group]

repos:
  - git: git@github.com:org/repo.git
    groups: [labeled]
    # PR options: merge: auto, labels: [from-group]
```

## Conditional Groups

Conditional groups activate automatically based on which groups a repo has.
They are defined in a top-level `conditionalGroups` array, separate from
regular groups.

### `allOf` — Intersection

Include config only when **all** listed groups are present:

```yaml
conditionalGroups:
  - when:
      allOf: [terraform, renovate]
    settings:
      labels:
        "renovate/terraform":
          color: "#ededed"
          description: ""
```

The `renovate/terraform` label is only added to repos that have both
`terraform` and `renovate` in their `groups` array.

### `anyOf` — Union

Include config when **any** listed group is present:

```yaml
conditionalGroups:
  - when:
      anyOf: [github-ci, github-trivy]
    files:
      .github/actionlint.yaml:
        content: "@templates/.github/actionlint.yaml"
```

### Combined Conditions

Both `allOf` and `anyOf` can be used together — both must be satisfied:

```yaml
conditionalGroups:
  - when:
      allOf: [renovate]
      anyOf: [go, terraform, typescript]
    settings:
      labels:
        "renovate/language":
          color: "#ededed"
```

This matches repos that have `renovate` **and** at least one of `go`,
`terraform`, or `typescript`.

### Merge Order

Conditional groups merge **after** explicit groups and **before** repo overrides:

1. **Root files/settings** — base layer
2. **Explicit group layers** — applied left-to-right
3. **Conditional group layers** — applied in array order
4. **Repo overrides** — final layer

Later conditional groups override earlier ones when they conflict.

### Full Parity with Regular Groups

Conditional groups support the same capabilities as regular groups:

- `files` with `inherit: false`, `override: true`, `file: false`
- `prOptions` for PR merge settings
- `settings` for rulesets, labels, and repo settings
- `inherit: false` on settings sub-sections

### Restrictions

- Group names in `allOf`/`anyOf` must reference groups defined in
  the `groups` map
- Conditional groups cannot be listed in a repo's `groups` array
- Conditional groups cannot reference other conditional groups
