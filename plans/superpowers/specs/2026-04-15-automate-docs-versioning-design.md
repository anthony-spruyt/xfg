# Automate docs version deployment

**Issue:** [#701](https://github.com/anthony-spruyt/xfg/issues/701)
**Status:** Approved design
**Date:** 2026-04-15

## Goal

Remove the hardcoded per-major build steps in `.github/workflows/docs.yaml` so adding a new major release requires no workflow edits, and unreleased main-branch docs never masquerade as a released version (the immediate problem today: v6 code on `main` is being published under the `5.x` and `latest` labels).

## Approach

Source of truth: the floating major tags (`v3`, `v4`, `v5`, …) maintained by `release.yaml`. Every release updates `v{MAJOR}` to the latest patch of that major; once a new major ships, the previous major's floating tag stops moving and permanently pins the prior major's docs.

Rewrite docs.yaml so that:

1. **All `N.x` version tabs are built from tags, never from `main`.** Loop every `v[0-9]+` floating tag and build from it as version `{N}.x` (using that tag's `mkdocs.yml`).
2. **`latest` alias points to the highest released major.** Determined by `git tag -l 'v[0-9]' | sort -V | tail -1`, fully deterministic from tags. No `package.json` dependency.
3. **`main` builds under a separate `next` alias (own version tab).** So unreleased docs are previewable but clearly not a released version. `next` never aliases `latest`.
4. **`mike set-default latest`** stays unchanged — the site still opens on the latest released major.

## Immediate effect when this merges

- `5.x` rebuilds from the `v5` tag (→ v5.7.0) — correct stable v5 docs.
- `latest` → `5.x` — correct.
- Current main content (v6 rename) builds under `next` — clearly unreleased.

## When v6 ships

- `release.yaml` creates `v6.0.0` and updates floating `v6`.
- Next `docs.yaml` run: loop picks up `v6`, builds `6.x` from it, `latest` flips to `6.x`.
- `main`/`next` continues to track main.
- Zero `docs.yaml` changes required.

## Implementation

Replace the three "Build vN docs" steps (current lines 55–70) with one loop step plus one `next` step. Keep the git config, Pages configuration, and `set-default` steps as-is.

```bash
# Build every released major from its floating tag
HIGHEST=$(git tag -l 'v[0-9]' | sort -V | tail -1)
for tag in $(git tag -l 'v[0-9]' | sort -V); do
  major="${tag#v}"
  workdir="/tmp/${tag}-docs"
  git worktree add "$workdir" "$tag"
  if [ "$tag" = "$HIGHEST" ]; then
    mike deploy --update-aliases --alias-type copy \
      --config-file "$workdir/mkdocs.yml" "${major}.x" latest
  else
    mike deploy --config-file "$workdir/mkdocs.yml" "${major}.x"
  fi
  git worktree remove "$workdir"
done

# Build unreleased main under the `next` alias (separate tab, not `latest`)
mike deploy next
```

## Acceptance criteria

- [ ] `docs.yaml` has no hardcoded major version numbers in build steps
- [ ] `5.x` tab rebuilds from the `v5` tag, not `main`
- [ ] `latest` alias points to `5.x` (highest released major), not main
- [ ] `main` content lives under a `next` tab
- [ ] Adding a future major (v6+) requires zero workflow edits
- [ ] `npm run build`, `./lint.sh`, actionlint green
- [ ] Manually triggered via `workflow_dispatch` on the PR branch to verify the site renders as expected before merge

## Out of scope

- Removing old majors from the selector (manual gh-pages curation)
- Prerelease / RC channels beyond the single `next` alias
- Changes to `mkdocs.yml`
- Changes to `release.yaml`
