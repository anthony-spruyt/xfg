# Migrating from v8 to v9

v9 gives every settings block and every array one merge model: objects merge field by field, a plain array replaces the inherited one, and `$arrayMerge` and `inherit: false` work everywhere. See [Settings Array Merge](configuration/merge-strategies.md#settings-array-merge) for the full rules.

Several blocks used to behave differently. They now follow the model, so a config that relied on the old behaviour can produce a different result or fail validation.

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

A merged `state: not-configured` keeps only `state`: `languages` and `querySuite` are dropped. A repo that switches code scanning off with `state: not-configured` gets the same result as before, without `inherit: false`.

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

### 4. `inherit: false` drops an inherited `deleteOrphaned`

`deleteOrphaned` is an ordinary field. `inherit: false` used to keep an inherited `deleteOrphaned` on `collaborators`, `variables`, `secrets` and `environments` while it dropped everything else. It now drops that too, in `collaborators`, `variables`, `secrets` (an environment's `secrets` included), `environments` and `deploymentBranchPolicy`.
A layer with `inherit: false` on one of those blocks no longer deletes anything on GitHub unless it sets `deleteOrphaned: true` itself.

Rulesets and labels do not change: `settings.deleteOrphaned` is a field of `settings`, not of the `rulesets` or `labels` map, so `inherit: false` on either map keeps it, and while it is `true` the inherited rulesets or labels the layer dropped are still deleted. Set `settings.deleteOrphaned: false` in that repo to keep them.

To get the old result on the other blocks, restate `deleteOrphaned` in the layer:

```yaml
id: my-config
settings:
  secrets:
    deleteOrphaned: true
    SHARED_KEY:
      env: SHARED

repos:
  - git: git@github.com:your-org/isolated.git
    settings:
      secrets:
        inherit: false
        deleteOrphaned: true     # old behavior: inherited from root
        OWN_KEY:
          env: OWN
```

### 5. `prOptions.ai` merges field by field

An `ai` object in a group or repo used to replace the inherited one whole, so a repo that set only `model` fell back to the Anthropic defaults. Now an omitted field is inherited, `provider`, `apiKeyEnv`, `headersEnv` and `fallback` included. `ai: true`, `ai: false` and the `ai: true` that re-enables a hidden `ai` object work as before.

xfg checks each layer's field types and allowed values on their own, and the rules that relate fields (an `openai` provider needs a `model`, which key goes with which `baseUrl`) on the merged `ai` of each repo. A layer that is incomplete alone is valid when another layer supplies the rest, and an error on the merged `ai` names the repo.

To get the old result, set `inherit: false` inside the `ai` object and state every field you want:

```yaml
id: my-config
files:
  README.md:
    content: "# Hello"

prOptions:
  ai:
    provider: openai
    model: gpt-4.1-mini
    apiKeyEnv: LLM_KEY

repos:
  - git: git@github.com:your-org/web.git
    prOptions:
      ai:
        inherit: false           # old behavior: replaces the inherited ai
        model: claude-haiku-4-5
```

### 6. A same-named ruleset or label under `inherit: false` replaces the inherited one

With `inherit: false` in the `rulesets` or `labels` map of a repo, a ruleset or label that had the same name as an inherited one used to merge with it field by field, and only the other inherited entries were dropped. Now it replaces the inherited entry, so any field you do not restate is gone.

To get the old result, drop the map-level `inherit: false` and opt out of the other inherited entries by name:

```yaml
id: my-config
settings:
  labels:
    bug:
      color: d73a4a
      description: "Something isn't working"
    enhancement:
      color: a2eeef

repos:
  - git: git@github.com:your-org/web.git
    settings:
      labels:
        enhancement: false       # was: inherit: false on the labels map
        bug:
          color: ff0000          # still inherits the description
```

### 7. `inherit: false` inside one ruleset, label or environment is honoured

`inherit: false` inside a single ruleset or label used to be ignored, and the entry still merged with the inherited one. An environment entry with `inherit: false` failed validation. Now it drops only that entry's inherited fields, and the entry starts fresh. Remove the line to keep the old result for a ruleset or label.

## Other Changes

These do not break a working config:

- `inherit: false` now works inside `repo`, `actions`, `codeScanning`, `deploymentBranchPolicy`, `prOptions` and `prOptions.ai`, and drops what the block would inherit.
- `$arrayMerge` works on every layered array, including `actions.patternsAllowed`, `codeScanning.languages`, `collaborators.users`, `deploymentBranchPolicy.custom`, `prOptions.labels` and the arrays inside ruleset rule parameters.
- Repeated strings and numbers are dropped from a merged array, first one wins. A repeated `languages` entry used to show up as a change on every run.
- `prOptions` is checked in every layer. A bad label in a group or repo that used to pass now fails validation.
