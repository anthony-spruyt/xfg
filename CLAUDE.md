# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

TypeScript CLI tool that syncs JSON, YAML, or text configuration files across multiple Git repositories by automatically creating pull requests. Output format is determined by content type: object content outputs JSON/YAML (based on file extension), while string or string array content outputs plain text. Supports both GitHub and Azure DevOps platforms.

## Architecture

### Config Normalization Pipeline (config.ts)

The config loading process normalizes raw YAML input into a standardized format:

```
Raw YAML → Parse → Validate → Expand git arrays → Deep merge per file → Env interpolate → Config
```

**Types**:

- `RawConfig` / `RawRepoConfig`: As parsed from YAML (flexible input format)
- `Config` / `RepoConfig`: Normalized output (each entry has single git URL + array of files with merged content)
- `FileContent`: Individual file with fileName and merged content
- `ContentValue`: Content type union - `Record<string, unknown> | string | string[]`

**Pipeline Steps**:

1. **Validation**: Check required fields (`files`, `repos`), validate file names (no path traversal)
2. **Git Array Expansion**: `git: [url1, url2]` becomes two separate repo entries
3. **Content Merge**: For each file, per-repo `content` overlays onto root-level file `content` using deep merge
4. **Env Interpolation**: Replace `${VAR}` placeholders with environment values

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
- Validation enforces: `.json`/`.yaml`/`.yml` must have object content; other extensions must have string/string[] content

**Subdirectory Support**: File names can include paths (e.g., `.github/workflows/ci.yml`). Parent directories are created automatically. Quote paths containing `/` in YAML keys.

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

**Options**:

- `strict: true` (default): Throw on missing required variables
- `strict: false`: Leave placeholders as-is if missing

### Orchestration Flow (index.ts)

The tool processes repositories sequentially with a 9-step workflow per repo:

1. Clean workspace (remove old clones)
2. Clone repository
3. Detect default branch (main/master)
4. Create/checkout sync branch (`chore/sync-config` or custom `--branch`)
5. Write all config files (JSON or YAML based on filename extension)
6. Check for changes (skip if none)
7. Commit changes
8. Push to remote
9. Create PR (platform-specific)

**Error Resilience**: If any repo fails, the tool continues processing remaining repos. Errors are logged and summarized at the end. Exit code 1 only if failures occurred.

### Platform Detection (repo-detector.ts)

Auto-detects GitHub vs Azure DevOps from git URL patterns:

- GitHub SSH: `git@github.com:owner/repo.git`
- GitHub HTTPS: `https://github.com/owner/repo.git`
- Azure SSH: `git@ssh.dev.azure.com:v3/org/project/repo`
- Azure HTTPS: `https://dev.azure.com/org/project/_git/repo`

Returns `RepoInfo` with normalized fields (owner, repo, organization, project) used by PR creator.

### PR Creation Strategy (pr-creator.ts)

**Idempotency**: Checks for existing PR on branch before creating new one. Returns URL of existing PR if found.

**Shell Safety**: Uses `escapeShellArg()` to wrap all user-provided strings passed to `gh`/`az` CLI. Special handling: wraps in single quotes and escapes embedded single quotes as `'\''`.

**Template System**: Loads PR body from `PR.md` file (included in npm package). Uses `{{FILES}}` placeholders for file list. Writes body to temp file to avoid shell escaping issues with multiline strings.

**PR Title**: Lists up to 3 files in title, or shows count for more files.

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

**Dry Run**: When `--dry-run` flag is used, commits and pushes are skipped, but file writes and branch creation still occur locally for validation.

## Configuration Format

See README.md for detailed examples and `config-schema.json` for validation. Key structure:

- `files`: Map of filenames to content/options (object for JSON/YAML, string/string[] for text)
- `repos`: Array with `git` URL(s) and optional per-repo `files` overrides
- `mergeStrategy`: Controls array/lines merging (replace/append/prepend)
- `createOnly`: Only create if file doesn't exist
- `header`/`schemaUrl`: YAML comment options

Output: 2-space indentation, trailing newline always added.

## Development Commands

```bash
npm run build              # Compile TypeScript to dist/
npm test                   # Run all unit tests
npm run test:integration   # Build + integration test (requires gh auth)
npm run dev                # Run with fixtures/test-repos-input.yaml
```

## Release Process

Branch protection prevents direct pushes to main, so releases require a PR workflow:

```bash
# 1. Create release branch from main
git checkout main && git pull
git checkout -b release/vX.Y.Z

# 2. Bump version (patch/minor/major)
npm version patch --no-git-tag-version   # or minor/major

# 3. Commit, push, and create PR
git add -A && git commit -m "chore: release vX.Y.Z"
git push -u origin release/vX.Y.Z
gh pr create --title "chore: release vX.Y.Z" --body "Release vX.Y.Z"

# 4. Wait for CI, then merge
gh pr merge --squash --delete-branch

# 5. Create and push tag (triggers npm publish + GitHub Release)
git checkout main && git pull
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

The release workflow automatically builds, tests, publishes to npm with provenance, and creates a GitHub Release.

## External Dependencies

**Required**:

- Node.js >= 18
- `git` CLI (for cloning/pushing)
- `gh` CLI (for GitHub repos) - must be authenticated via `gh auth login`
- `az` CLI (for Azure DevOps repos) - must be authenticated and configured

**Package Structure**:

- Published as ESM (`"type": "module"`)
- Uses `.js` extensions in imports (TypeScript requirement for NodeNext)
- Binary entry point: `dist/index.js` (has shebang)

## Testing Approach

**Unit Tests**: Each `src/*.ts` module has a corresponding `*.test.ts` file. Uses fixtures in `fixtures/` directory.

**Integration Tests**: End-to-end test using real GitHub repo (`anthony-spruyt/json-config-sync-test`). Requires `gh` CLI authentication. No mocking of git/CLI operations.
