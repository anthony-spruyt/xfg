# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

TypeScript CLI tool that syncs JSON, JSON5, YAML, or text configuration files across multiple Git repositories. By default, changes are made via pull requests, but you can also push directly to the default branch with `merge: direct`. Output format is determined by content type: object content outputs JSON/JSON5/YAML (based on file extension), while string or string array content outputs plain text. Supports GitHub, Azure DevOps, and GitLab platforms (including self-hosted GitLab instances).

## Documentation

Full documentation is available at https://anthony-spruyt.github.io/xfg/

The docs site is built with MkDocs Material and auto-deploys via GitHub Actions when changes are made to `docs/` or `mkdocs.yml`.

**IMPORTANT: When updating documentation, update BOTH locations:**

- `README.md` - Quick start, features overview, badges
- `docs/` - Full documentation (GitHub Pages site)

Examples that appear in both places:

- GitHub Action usage examples
- CLI usage examples
- Token/authentication requirements

## Architecture

### Config Normalization Pipeline (config.ts)

The config loading process normalizes raw YAML input into a standardized format:

```
Raw YAML → Parse → Resolve file refs → Validate → Expand git arrays → Deep merge per file → Env interpolate → Config
```

**Types**:

- `RawConfig` / `RawRepoConfig`: As parsed from YAML (flexible input format)
- `Config` / `RepoConfig`: Normalized output (each entry has single git URL + array of files with merged content)
- `FileContent`: Individual file with fileName and merged content
- `ContentValue`: Content type union - `Record<string, unknown> | string | string[]`

**Pipeline Steps**:

1. **File Reference Resolution**: Replace `@path/to/file` content with actual file contents (JSON/JSON5/YAML parsed as objects, other files as strings)
2. **Validation**: Check required fields (`files`, `repos`), validate file names (no path traversal)
3. **Git Array Expansion**: `git: [url1, url2]` becomes two separate repo entries
4. **Content Merge**: For each file, per-repo `content` overlays onto root-level file `content` using deep merge
5. **Env Interpolation**: Replace `${VAR}` placeholders with environment values

### Content Inheritance (3 levels)

1. **Global file content** (`files[fileName].content`) - base for all repos
2. **Per-repo overlay** (`repos[].files[fileName].content`) - merged with global
3. **Per-repo override** (`repos[].files[fileName].override: true`) - replaces global entirely

**File Exclusion**: Set `repos[].files[fileName]: false` to exclude a file from a specific repo.

**Create-Only Mode**: Set `files[fileName].createOnly: true` to only create a file if it doesn't exist. Per-repo can override with `repos[].files[fileName].createOnly: false`.

**Empty Files**: Omit `content` to create an empty file. Useful for files like `.prettierignore` that just need to exist.

**YAML Comments**: For YAML output files, use `header` and/or `schemaUrl` to add comments at the top of the file:

- `schemaUrl`: Adds `# yaml-language-server: $schema=<url>` directive for IDE support
- `header`: Adds custom comment lines (string or array of strings)

**Text Files**: For non-JSON/YAML files (`.gitignore`, `.markdownlintignore`, etc.), use string or string array content:

- String content: `content: "line1\nline2"` or multiline `content: |-`
- Lines array: `content: ["line1", "line2"]` - supports merge strategies (append/prepend/replace)
- Validation enforces: `.json`/`.json5`/`.yaml`/`.yml` must have object content; other extensions must have string/string[] content

**File References**: Use `content: "@path/to/file"` to load content from external template files:

- Paths are relative to the config file's directory
- JSON/JSON5/YAML files are parsed as objects; other files are returned as strings
- Resolved before validation, so content type checking works on resolved content
- Per-repo overlays can merge onto resolved file content
- Security: paths restricted to config directory tree (no `../` escapes, no absolute paths)

**Subdirectory Support**: File names can include paths (e.g., `.github/workflows/ci.yml`). Parent directories are created automatically. Quote paths containing `/` in YAML keys.

**Executable Files**: Files ending in `.sh` are auto-marked executable via `git update-index --add --chmod=+x`. Use `executable: false` to disable. Non-.sh files can be marked executable with `executable: true`. Per-repo can override root-level `executable` setting.

### Deep Merge (merge.ts)

Recursive object merging with configurable array handling:

**Key Functions**:

- `deepMerge(base, overlay, ctx)`: Merge two objects, overlay wins for conflicts
- `stripMergeDirectives(obj)`: Remove `$`-prefixed keys from output
- `createMergeContext(strategy)`: Create context with default array strategy
- `isTextContent(content)`: Type guard for string or string[] content
- `mergeTextContent(base, overlay, strategy)`: Merge text content with strategy support

**Array Merge Strategies**:

- `replace` (default): Overlay array replaces base array
- `append`: Overlay array concatenated after base array
- `prepend`: Overlay array concatenated before base array

**Merge Directives**:

- `$arrayMerge`: Set strategy for child arrays in that object
- Directive keys stripped from final output

### Environment Interpolation (env.ts)

Replaces environment variable placeholders in string values:

**Supported Syntax**:

- `${VAR}`: Required variable (errors if missing in strict mode)
- `${VAR:-default}`: Use default if variable is not set
- `${VAR:?message}`: Required with custom error message
- `$${VAR}`: Escape - outputs literal `${VAR}` without interpolation

**Escape Mechanism**: Use `$$` prefix to prevent interpolation. `$${VAR}` outputs `${VAR}` literally. Useful for devcontainer.json, shell scripts, and other templating systems that use `${...}` syntax.

**Options**:

- `strict: true` (default): Throw on missing required variables
- `strict: false`: Leave placeholders as-is if missing

### Orchestration Flow (index.ts)

The tool processes repositories sequentially. The workflow depends on the merge mode:

**PR modes (manual/auto/force):**

1. Clean workspace (remove old clones)
2. Clone repository
3. Detect default branch (main/master)
4. Close existing PR if exists (fresh start)
5. Create/checkout sync branch (`chore/sync-config` or custom `--branch`)
6. Write all config files (JSON or YAML based on filename extension)
7. Check for changes (skip if none)
8. Commit changes
9. Push to sync branch
10. Create PR (platform-specific)
11. Merge PR (if `prOptions.merge` is `auto` or `force`)

**Direct mode (`merge: direct`):**

1. Clean workspace (remove old clones)
2. Clone repository
3. Detect default branch (main/master)
4. Stay on default branch (no sync branch created)
5. Write all config files
6. Check for changes (skip if none)
7. Commit changes
8. Push directly to default branch
9. Done (no PR created)

**Error Resilience**: If any repo fails, the tool continues processing remaining repos. Errors are logged and summarized at the end. Exit code 1 only if failures occurred.

### Platform Detection (repo-detector.ts)

Auto-detects GitHub, Azure DevOps, or GitLab from git URL patterns:

- GitHub SSH: `git@github.com:owner/repo.git`
- GitHub HTTPS: `https://github.com/owner/repo.git`
- Azure SSH: `git@ssh.dev.azure.com:v3/org/project/repo`
- Azure HTTPS: `https://dev.azure.com/org/project/_git/repo`
- GitLab SaaS SSH: `git@gitlab.com:owner/repo.git`
- GitLab SaaS HTTPS: `https://gitlab.com/owner/repo.git`
- GitLab Self-hosted: Fallback detection for any domain with GitLab URL patterns
- GitLab Nested Groups: `gitlab.com/org/group/subgroup/repo`

Returns `RepoInfo` with normalized fields (owner, repo, organization, project, namespace, host) used by PR/MR creator.

### PR Creation Strategy (pr-creator.ts)

**Idempotency**: Checks for existing PR on branch before creating new one. Returns URL of existing PR if found.

**Shell Safety**: Uses `escapeShellArg()` to wrap all user-provided strings passed to `gh`/`az`/`glab` CLI. Special handling: wraps in single quotes and escapes embedded single quotes as `'\''`.

**Template System**: Loads PR body from `PR.md` file (included in npm package). Uses `{{FILES}}` placeholders for file list. Writes body to temp file to avoid shell escaping issues with multiline strings.

**PR Title**: Lists up to 3 files in title, or shows count for more files.

### PR Merge Options (strategies/)

After PR creation, the tool can automatically merge or enable auto-merge based on `prOptions`:

**Types** (config.ts):

- `MergeMode`: `"manual"` | `"auto"` | `"force"` | `"direct"`
- `MergeStrategy`: `"merge"` | `"squash"` | `"rebase"`
- `PRMergeOptions`: Config interface with `merge`, `mergeStrategy`, `deleteBranch`, `bypassReason`

**Option Inheritance**: Global `prOptions` → per-repo `prOptions` → CLI flags (highest priority)

**Merge Modes**:

| Mode     | GitHub                                     | Azure DevOps                              | GitLab                                   |
| -------- | ------------------------------------------ | ----------------------------------------- | ---------------------------------------- |
| `manual` | Leave PR open (default)                    | Leave PR open                             | Leave MR open                            |
| `auto`   | `gh pr merge --auto` (requires repo setup) | `az repos pr update --auto-complete true` | `glab mr merge --when-pipeline-succeeds` |
| `force`  | `gh pr merge --admin` (bypass checks)      | `--bypass-policy true --status completed` | `glab mr merge -y` (merge immediately)   |
| `direct` | Push directly to default branch (no PR)    | Push directly to default branch (no PR)   | Push directly to default branch (no MR)  |

**GitHub Auto-Merge Handling**: Before enabling auto-merge, checks if `allow_auto_merge` is enabled on the repository via `gh api`. If not enabled, logs a warning with instructions and falls back to manual mode.

**Direct Mode Handling**: When `merge: direct` is set, the tool skips PR creation entirely and pushes directly to the default branch. If push is rejected (likely due to branch protection), returns a helpful error suggesting to use `merge: force` instead.

**GitLab Merge Handling**: Uses `glab mr merge --when-pipeline-succeeds` for auto mode (merges when CI pipeline passes). Force mode merges immediately without waiting for pipeline.

**CLI Flags**: `--merge`, `--merge-strategy`, `--delete-branch` override config file settings.

### Git Operations (git-ops.ts)

**Branch Strategy**:

- Default branch: `chore/sync-config` (or custom `--branch`)
- Checks if branch exists on remote first (`git fetch origin <branch>`)
- Reuses existing branch if found, otherwise creates new one
- This allows updates to existing PRs instead of creating duplicates

**Default Branch Detection**: Tries multiple methods in order:

1. `git remote show origin` (parse HEAD branch)
2. Check if `origin/main` exists
3. Check if `origin/master` exists
4. Default to `main`

**Dry Run**: When `--dry-run` flag is used, file writes, commits, and pushes are skipped. Change detection uses `wouldChange()` for read-only content comparison. Branch creation still occurs locally.

## Configuration Format

See README.md for detailed examples and `config-schema.json` for validation. Key structure:

- `files`: Map of filenames to content/options (object for JSON/YAML, string/string[] for text)
- `repos`: Array with `git` URL(s) and optional per-repo `files` overrides
- `prOptions`: Global PR merge options (`merge`, `mergeStrategy`, `deleteBranch`, `bypassReason`)
- `mergeStrategy`: Controls array/lines merging (replace/append/prepend)
- `createOnly`: Only create if file doesn't exist
- `header`/`schemaUrl`: YAML comment options

Output: 2-space indentation, trailing newline always added.

## Development Commands

```bash
npm run build                   # Compile TypeScript to dist/
npm test                        # Run all unit tests
npm run test:integration:github # Build + GitHub integration test (requires gh auth)
npm run test:integration:ado    # Build + Azure DevOps integration test (requires az auth)
npm run test:integration:gitlab # Build + GitLab integration test (requires glab auth)
npm run dev                     # Run CLI via ts-node (pass config file as argument)
```

## Release Process

Run the Release workflow via Actions UI or CLI:

```bash
gh workflow run release.yaml -f version=patch  # or minor/major
```

The workflow bumps version, creates a verified commit on main, waits for CI, tags, publishes to npm, and creates a GitHub Release.

## External Dependencies

**Required**:

- Node.js >= 18
- `git` CLI (for cloning/pushing)
- `gh` CLI (for GitHub repos) - must be authenticated via `gh auth login`
- `az` CLI (for Azure DevOps repos) - must be authenticated and configured
- `glab` CLI (for GitLab repos) - must be authenticated via `glab auth login`

**Package Structure**:

- Published as ESM (`"type": "module"`)
- Uses `.js` extensions in imports (TypeScript requirement for NodeNext)
- Binary entry point: `dist/index.js` (has shebang)

## Testing Approach

**Unit Tests**: Each `src/*.ts` module has a corresponding `*.test.ts` file. Uses fixtures in `fixtures/` directory.

**Integration Tests**: End-to-end test using real GitHub repo (`anthony-spruyt/xfg-test`). Requires `gh` CLI authentication. No mocking of git/CLI operations.
