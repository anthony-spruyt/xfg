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
2. `npm run test:typecheck` - Test file type checking (catches broken imports/types in tests)
3. `./lint.sh` - Linting
4. Integration tests (for ALL behavioral changes that integration tests can cover):
   - `npm run test:integration:github`
   - `npm run test:integration:ado`
   - `npm run test:integration:gitlab`

## Release

```bash
gh workflow run release.yaml -f version=patch  # or minor/major
```

## External Dependencies

- Node.js >= 18
- `git`, `gh`, `az`, `glab` CLIs (platform-specific, must be authenticated)

## Architecture Principles

This codebase follows SOLID principles strictly. Do NOT violate these:

- **Dependency Injection**: Never import singletons (e.g. `logger`) in shared utilities or library code. Accept dependencies via constructor or function parameters. Only CLI entry points and composition roots may import singletons directly.
- **Interfaces for testability**: Every collaborator is injected via an interface. Single-impl interfaces are correct and intentional — do NOT inline them or couple to concrete classes.
- **Composition over inheritance**: Use strategy pattern, delegation, and interface-based injection. Do NOT flatten abstractions or suggest inheritance.
- **Interface Segregation**: Keep interfaces focused. A class needing only `{ debug(msg: string): void }` should accept that, not the full `ILogger`.
- **No static coupling in libraries**: `src/shared/` and `src/sync/` modules must not import global singletons. Pass them in.

## Key Modules

| Module                     | Purpose                                                                       |
| -------------------------- | ----------------------------------------------------------------------------- |
| `config-normalizer.ts`     | Parses config, expands git arrays, merges content, interpolates env vars      |
| `repository-processor.ts`  | Orchestrates per-repo: clone, write files, commit, PR/push                    |
| `authenticated-git-ops.ts` | Wraps GitOps with per-command auth via `-c url.insteadOf`                     |
| `xfg-template.ts`          | `${xfg:repo.name}` templating for repo-specific content                       |
| `manifest.ts`              | Tracks managed files for orphan deletion (`deleteOrphaned`)                   |
| `github-summary.ts`        | Writes job summary to `GITHUB_STEP_SUMMARY` in CI                             |
| `config-validator.ts`      | Validates raw config via `validateForSync` (accepts files, settings, or both) |

## GitHub Rulesets API

- `conditions.ref_name` requires both `include` and `exclude` arrays (even if empty)
- `pull_request` rules require ALL parameters - provide defaults for missing ones
- Test locally with: `node dist/index.js sync --config <config.yaml>`

## Linting Gotchas

- Use `String.fromCharCode(0x1b)` for ANSI escape in regex - `\x1b` and `\u001b` literals fail `no-control-regex`
- CodeQL alerts are separate from ESLint - `eslint-disable` comments don't suppress CodeQL
- Use underscore prefix (`_varName`) for intentionally unused destructured variables

## Gotchas

- **Always create fresh branch from main** before starting work - old branches may already be merged
- **After PR merged, checkout main and pull** before any new work - don't reuse old branches
- **Enable automerge after PR creation:** `gh pr merge <num> --auto --squash --delete-branch`
- **Wait for CI before claiming done** - verify checks pass, don't just run local lint
- **Check CI on main after PR merge** - verify integration tests pass before releasing
- **Do not commit plans or specs to `docs/`** - that's GitHub Pages; use `plans/` for plans and `plans/superpowers/` for superpowers specs/plans (the plugin defaults to `docs/superpowers/` which triggers docs deploy)
- **Do not commit plans to main branch** - create a new branch
- Output format determined by file extension: `.json`/`.json5`/`.yaml`/`.yml` → object content; others → string/string[]
- Escape `${VAR}` as `$${VAR}` to output literal (for devcontainer.json, shell scripts)
- Escape `${xfg:var}` as `$${xfg:var}` similarly
- `.sh` files auto-marked executable unless `executable: false`
- PR branch default: `chore/sync-config` (reuses existing branch/PR if found)

## Desloppify Scanning

**NEVER use `--force-rescan`.** It resets plan state, reopens all chronic false positives, and tanks the strict score. Work through the queue instead — if the queue has subjective re-review items, resolve them or skip them, then scan normally.

## Desloppify False Positives

**NEVER use `--permanent` (wontfix) for false positives.** Use `--false-positive` instead. Wontfix tanks strict score. This has been violated multiple times — DO NOT repeat.

```bash
# CORRECT — false positive or not-worth-it:
desloppify plan skip --false-positive "<id>" --attest "..."

# WRONG — this is wontfix and penalizes strict score:
desloppify plan skip --permanent "<id>" --note "..." --attest "..."
```

Only use `--permanent` for genuine issues deliberately accepted as technical debt.

## Desloppify Reviews

When running blind subjective reviews (subagent reviewers), ALWAYS instruct them to follow SOLID principles and composition over inheritance:

- **Dependency Inversion**: Single-impl interfaces for DI/testability are CORRECT — do NOT penalize them
- **Composition over Inheritance**: Strategy pattern, delegation, interface-based injection are BETTER than inlining or using concrete classes directly — do NOT suggest removing interfaces in favor of jest.spyOn or coupling to implementations
- **Interface Segregation**: Focused interfaces are good even if there's one implementation
- **Named type aliases** add semantic clarity at zero cost — do NOT penalize them
- **Do NOT encourage inheritance** by suggesting inlining composed strategies or removing abstraction layers that enable DI

### Subagent Rate Limits

**NEVER launch more than 3 subagents at a time.** Launching 20 parallel review agents burned the user's entire 5-hour token budget in minutes. Follow this process:

1. Launch 2-3 subagents max in the first batch
2. Wait for them to complete and verify they produced valid output
3. Only then launch the next batch of 2-3
4. Continue until all batches are done

This applies to ALL subagent work, not just desloppify reviews.
