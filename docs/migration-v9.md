# Migrating from v8 to v9

v9 gives every settings block and every array one merge model: objects merge field by field, a plain array replaces the inherited one, and `$arrayMerge` and `inherit: false` work everywhere. See [Settings Array Merge](configuration/merge-strategies.md#settings-array-merge) for the full rules.

Three blocks used to behave differently. They now follow the model, so a config that relied on the old behaviour can produce a different result or fail validation.

## Breaking Changes

### 1. `collaborators.users` plain lists replace

Users from every layer used to be added together. A plain `users` list now replaces the inherited one.

To keep adding users, use `$arrayMerge: append`:

```yaml
id: my-config
settings:
  collaborators:
    users: [my-bot]

repos:
  - git: git@github.com:your-user/foo.git
    settings:
      collaborators:
        users:
          $arrayMerge: append    # my-bot + other-bot, as before
          $values: [other-bot]
```

With `deleteOrphaned: true`, a repo's plain list now removes the inherited users from that repo.

### 2. `codeScanning` merges field by field

A layer's `codeScanning` block used to replace the inherited one whole, so omitting `languages` meant auto-detect. Now an omitted field is inherited, `languages` included.

To get the old result, set `inherit: false` in the layer and state every field you want:

```yaml
id: my-config
settings:
  codeScanning:
    state: configured
    languages: [go]

repos:
  - git: git@github.com:your-org/web.git
    settings:
      codeScanning:
        inherit: false           # old behavior: replaces the inherited block
        state: configured
        querySuite: extended
```

`state` may now be left out of a layer, but some layer must set it. xfg checks this after the layers merge.

### 3. `deploymentBranchPolicy` merges field by field

A policy set in a layer used to replace the inherited one whole, and `deleteOrphaned` had to be restated each time. Now the fields merge. Three results follow:

- A layer that switches between `protectedBranches: true` and `custom` must set `inherit: false`. Without it, the merged policy holds both and validation fails with a hint to use `inherit: false`.
- `deleteOrphaned` is inherited. It works on the merged `custom` list, so a repo that replaces `custom` with a plain list deletes the inherited patterns on GitHub. To keep them, use `$arrayMerge: append`.
- `$arrayMerge: merge` is not accepted on `custom`, with or without `$matchBy`: a pattern is identified by its type and name together. Use `append`, `prepend` or `replace`.

To get the old result, set `inherit: false` and restate the policy:

```yaml
id: my-config
settings:
  environments:
    release:
      deploymentBranchPolicy:
        protectedBranches: true

repos:
  - git: git@github.com:your-org/app.git
    settings:
      environments:
        release:
          deploymentBranchPolicy:
            inherit: false       # old behavior: replaces the inherited policy
            custom:
              - { type: tag, name: "v*" }
            deleteOrphaned: true
```

## Other Changes

These do not break a working config:

- `inherit: false` now works inside `repo`, `actions`, `codeScanning`, `deploymentBranchPolicy` and `prOptions`, and drops what the block would inherit.
- `$arrayMerge` works on every layered array, including `actions.patternsAllowed`, `codeScanning.languages`, `collaborators.users`, `deploymentBranchPolicy.custom`, `prOptions.labels` and the arrays inside ruleset rule parameters.
- Repeated strings and numbers are dropped from a merged array, first one wins. A repeated `languages` entry used to show up as a change on every run.
- `prOptions` is checked in every layer. A bad label in a group or repo that used to pass now fails validation.
