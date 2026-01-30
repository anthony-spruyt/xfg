# CLAUDE.md

## Overview

TypeScript CLI tool that syncs JSON, JSON5, YAML, or text config files across multiple Git repositories via PRs (or direct push with `merge: direct`). Supports GitHub, Azure DevOps, and GitLab (including self-hosted).

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

| Module                    | Purpose                                                                  |
| ------------------------- | ------------------------------------------------------------------------ |
| `config-normalizer.ts`    | Parses config, expands git arrays, merges content, interpolates env vars |
| `repository-processor.ts` | Orchestrates per-repo: clone, write files, commit, PR/push               |
| `xfg-template.ts`         | `${xfg:repo.name}` templating for repo-specific content                  |
| `manifest.ts`             | Tracks managed files for orphan deletion (`deleteOrphaned`)              |
| `github-summary.ts`       | Writes job summary to `GITHUB_STEP_SUMMARY` in CI                        |

## Gotchas

- **Always create fresh branch from main** before starting work - old branches may already be merged
- **Do not commit plans to `docs/`** - that's GitHub Pages; use scratchpad for temporary plans
- Output format determined by file extension: `.json`/`.json5`/`.yaml`/`.yml` → object content; others → string/string[]
- Escape `${VAR}` as `$${VAR}` to output literal (for devcontainer.json, shell scripts)
- Escape `${xfg:var}` as `$${xfg:var}` similarly
- `.sh` files auto-marked executable unless `executable: false`
- PR branch default: `chore/sync-config` (reuses existing branch/PR if found)
