---
name: repo-operator
description: Explains how repo-operator syncs shared files with xfg and where each kind of change belongs. Use when a hook says a file is xfg-managed or synced, or when a task changes anything repo-operator manages - CI workflows, lint.sh, .devcontainer, synced .claude files, Renovate presets, Mergify, rulesets and repo settings, container retention.
---

# repo-operator

[repo-operator](https://github.com/anthony-spruyt/repo-operator) syncs shared config to its repos with [xfg](https://github.com/anthony-spruyt/xfg). A synced file is overwritten on every sync, so a change made in the target repo is lost. Change the source in repo-operator.

## How xfg works

- Config is `src/` in repo-operator: `base.yaml` (`id`, `deleteOrphaned`, `prOptions`) plus the fragment files named in the table below.
- `content: "@templates/<path>"` points at `src/templates/<path>`, resolved relative to the fragment file. Everything distributed lives in `src/templates/`.
- Groups are named bundles of files and settings and can `extends` other groups. A repo opts in through `groups:` in `repos.yaml`.
- Conditional groups apply files or settings by which groups a repo has, with `allOf`, `anyOf` and `noneOf`. Use them for cross-cutting rules (for example rulesets that differ when `mergify` is present).
- `createOnly: true` seeds a file once and never overwrites it. Use it for files a repo customises (`.gitignore`, `.mega-linter.yml`, `renovate-overrides.json5`). Without it the file is overwritten on every sync.
- `$arrayMerge: append` with `$values: [...]` appends to an array (pre-commit `repos`, devcontainer `extensions`). Plain YAML keys replace the array.
- `deleteOrphaned: true` plus the `.xfg.json` manifest: xfg records what it synced under the config `id`, and deletes a recorded file from the repos once it leaves `src/`.
- `template: true` with `vars` substitutes `${xfg:name}` and built-ins such as `${xfg:repo.fullName}` in a file. An unknown variable fails the sync.
- xfg substitutes an env reference in any synced content: a dollar sign, a brace, an identifier and a closing brace, with an optional `:-default` or `:?message`. An unset one fails the sync. Double the dollar sign (`$$` before the brace) to emit it literally, as `lint.sh.tmpl` does for shell expansions. GitHub expressions and `${xfg:...}` in a non-template file pass through unchanged. A shell
  template that holds `${xfg:...}` takes a `.tmpl` extension (`lint.sh.tmpl`) so shellcheck skips it.
- Comments in YAML/JSON templates are not synced: xfg parses and regenerates them with only the `header:` lines from `groups.yaml`. Explain non-obvious config via a `header:` link or repo-operator's docs. Shell and markdown templates keep their comments.
- `.github/xfg-managed.json` maps each repo to the files xfg overwrites there (not `createOnly` ones). `.claude/xfg-managed.sh` reads it from repo-operator's `main` (cached 15 minutes in the git dir). A `PreToolUse` hook blocks Edit, MultiEdit, Write, NotebookEdit and Bash writes to a listed file, and a pre-commit hook refuses commits that change one. The `claude` group syncs all three. In
  repo-operator the root copies are synced too: edit `src/templates/` and let Apply write them.

## Where to change what

| Change                                                  | Where (in repo-operator)                                                                                                                                                                 |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content of a synced file                                | `src/templates/<path>`; wired in `src/files.yaml` (all repos) or the group in `src/groups.yaml`                                                                                          |
| One repo differs                                        | `files:` overlay under that repo in `src/repos.yaml`                                                                                                                                     |
| Which repos get a file                                  | `groups:` list in `src/repos.yaml`, or a conditional group in `src/groups.yaml`                                                                                                          |
| CI workflows                                            | `src/templates/.github/workflows/`; the shared reusable workflows are `.github/workflows/_*.yaml` (`docs/ci.md`)                                                                         |
| `lint.sh` and the MegaLinter image pin                  | `src/templates/lint.sh.tmpl`; the `megalinterImage` var comes from the `megalinter-flavor` conditional groups, or a per-repo override in `src/repos.yaml`; Renovate bumps the pins there |
| `.devcontainer`                                         | `src/templates/.devcontainer/`                                                                                                                                                           |
| Synced `.claude` files (rules, hooks, settings, skills) | `src/templates/.claude/`; wired in the `claude` group, or another group or conditional group in `src/groups.yaml`                                                                        |
| Renovate presets                                        | `.github/renovate/*.json5` in repo-operator (not synced; repos extend them directly)                                                                                                     |
| One repo's Renovate rules                               | `renovate-overrides.json5` in that repo (`createOnly`)                                                                                                                                   |
| Mergify                                                 | `src/templates/.mergify.yml`; the `mergify` group                                                                                                                                        |
| Rulesets, repo settings, labels                         | `src/settings.yaml`, or `settings:` in a group or repo                                                                                                                                   |
| Container retention                                     | Nothing per repo: `container-retention.yaml` finds the packages itself; only a root image not named after the repo needs the `image` input (`docs/ci.md`)                                |
| A `createOnly` file                                     | Edit it in the target repo; a sync never touches it again                                                                                                                                |

## Dry-run

After any change under `src/`, dry-run before pushing. It catches rules deduplicated by type, wrong array merging and missing file references. Run it from a repo-operator clone with the xfg version CI pins (the `# v...` comment on the `anthony-spruyt/xfg` action in `.github/workflows/ci.yaml`). `gh` must be logged in; set `GH_TOKEN` only if it is not:

```bash
SAFE_CHAIN_MINIMUM_PACKAGE_AGE_HOURS=0 npx --yes @aspruyt/xfg@<CI version> sync --config ./src --dry-run
```

Without the age override, safe-chain refuses a freshly released xfg version.

## Sync flow

1. Change repo-operator through a PR. CI runs lint and a partial preview plan; the read-only Plan App cannot see merge settings or ruleset bypass actors, so those always show as changes.
2. Merge. Merging does not sync. On `main`, XFG Plan runs the full dry-run, then the `XFG Apply` job waits for the owner to approve the `production` environment. Both skip when `src/` is unchanged since the last deploy.
3. After approval, the sync lands as direct commits on each downstream repo's `main` (`prOptions.merge: direct`, no PR), then records the deployed commit.
4. At merge, send the owner the XFG Apply run link. Never wait silently on a merged change.
