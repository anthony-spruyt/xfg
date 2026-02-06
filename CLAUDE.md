# CLAUDE.md

## Overview

TypeScript CLI tool for repository-as-code: sync files and manage settings across GitHub, Azure DevOps, and GitLab (including self-hosted). Changes via PRs by default, or direct push with `merge: direct`.

## Documentation

Full docs: <https://anthony-spruyt.github.io/xfg/>

**When updating docs, update BOTH:**

- `README.md` - Badges, quick start only
- `docs/` - Full documentation (GitHub Pages)

## Development

```bash
npm run build    # Compile TypeScript
npm test         # Run unit tests
npm run dev      # Run CLI via ts-node
```

## Pre-PR Checklist

**MUST pass before any PR:**

1. `npm test` - Unit tests
2. `./lint.sh` - Linting
3. Integration tests (if CLI behavior changed):
   - `npm run test:integration:github`
   - `npm run test:integration:ado`
   - `npm run test:integration:gitlab`

**Note:** CI integration tests only run on `main` branch, not on PR branches.

## Release

```bash
gh workflow run release.yaml -f version=patch  # or minor/major
```

## External Dependencies

- Node.js >= 18
- `git`, `gh`, `az`, `glab` CLIs (platform-specific, must be authenticated)

## Key Modules

| Module                     | Purpose                                                                   |
| -------------------------- | ------------------------------------------------------------------------- |
| `config-normalizer.ts`     | Parses config, expands git arrays, merges content, interpolates env vars  |
| `repository-processor.ts`  | Orchestrates per-repo: clone, write files, commit, PR/push                |
| `authenticated-git-ops.ts` | Wraps GitOps with per-command auth via `-c url.insteadOf`                 |
| `xfg-template.ts`          | `${xfg:repo.name}` templating for repo-specific content                   |
| `manifest.ts`              | Tracks managed files for orphan deletion (`deleteOrphaned`)               |
| `github-summary.ts`        | Writes job summary to `GITHUB_STEP_SUMMARY` in CI                         |
| `config-validator.ts`      | Validates raw config; `validateForSync`/`validateForSettings` per-command |

## GitHub Rulesets API

- `conditions.ref_name` requires both `include` and `exclude` arrays (even if empty)
- `pull_request` rules require ALL parameters - provide defaults for missing ones
- Test locally with: `node dist/index.js settings --config <config.yaml>`

## Linting Gotchas

- Use `String.fromCharCode(0x1b)` for ANSI escape in regex - `\x1b` and `\u001b` literals fail `no-control-regex`
- CodeQL alerts are separate from ESLint - `eslint-disable` comments don't suppress CodeQL
- Use underscore prefix (`_varName`) for intentionally unused destructured variables

## Gotchas

- **Always create fresh branch from main** before starting work - old branches may already be merged
- **After PR merged, checkout main and pull** before any new work - don't reuse old branches
- **Enable automerge after PR creation:** `gh pr merge <num> --auto --squash --delete-branch`
- **Wait for CI before claiming done** - verify checks pass, don't just run local lint
- **Check CI on main after PR merge** - integration tests only run on main; verify they pass before releasing
- **Do not commit plans to `docs/`** - that's GitHub Pages; use `plans/` for plans
- **Do not commit plans to main branch** - create a new branch
- Output format determined by file extension: `.json`/`.json5`/`.yaml`/`.yml` → object content; others → string/string[]
- Escape `${VAR}` as `$${VAR}` to output literal (for devcontainer.json, shell scripts)
- Escape `${xfg:var}` as `$${xfg:var}` similarly
- `.sh` files auto-marked executable unless `executable: false`
- PR branch default: `chore/sync-config` (reuses existing branch/PR if found)
