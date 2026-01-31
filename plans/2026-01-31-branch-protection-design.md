# Branch Protection & Repo-as-Code Design

**Issue:** [#140](https://github.com/anthony-spruyt/xfg/issues/140)
**Date:** 2026-01-31
**Status:** Approved

## Overview

Extend xfg from a file sync tool into a full repo-as-code solution. This design covers branch protection (Phase 1) and establishes the architecture for repo creation, fork management, and comprehensive settings management (future phases).

## Use Cases

1. **Consistent security baseline** - Ensure all repos have minimum protection (e.g., require reviews on main)
2. **Compliance enforcement** - Auditable, version-controlled branch policies for regulated environments
3. **Onboarding automation** - New repos automatically get standard protection rules
4. **Fork management** (future) - Fork repos and configure them with preferred settings

## Design Decisions

### Subcommands

Introduce subcommands to separate concerns:

| Command       | Purpose                                         |
| ------------- | ----------------------------------------------- |
| `xfg sync`    | File sync (current behavior)                    |
| `xfg protect` | Branch protection management                    |
| `xfg` (bare)  | Alias to `xfg sync` for backwards compatibility |

**Rationale:** Clean separation enables independent operation (e.g., apply protection to existing repos without file changes), different permissions (sync needs write, protection needs admin), and future extensibility.

### Config Schema

Root-level `settings` mirrors the existing `files` pattern - define defaults at root, override per-repo:

```yaml
id: my-config

prOptions:
  merge: auto
prTemplate: "..."
deleteOrphaned: true

# Root-level settings = defaults for all repos
settings:
  features:
    wiki: false
    projects: false
  mergeOptions:
    allowSquash: true
    allowMerge: false
    deleteBranchOnMerge: true
  branchProtection:
    main:
      requiredReviews: 1
      dismissStaleReviews: true

# Existing file defaults
files:
  .github/dependabot.yml:
    content: { ... }

repos:
  # Gets all defaults
  - git: "org/standard-repo"
    files: { ... }

  # Overrides specific settings (deep merged with root)
  - git: "org/critical-repo"
    settings:
      branchProtection:
        main:
          requiredReviews: 3 # override
        develop:
          requiredReviews: 1 # additional branch
    files: { ... }
```

**Key points:**

- `settings` at root = defaults for all repos
- `settings` per-repo = deep merged with root defaults (consistent with `files`)
- No breaking changes to existing configs

### Branch Protection Rules Schema

GitHub API-aligned with camelCase field names:

```yaml
settings:
  branchProtection:
    main:
      # Required reviews
      requiredReviews: 2
      dismissStaleReviews: true
      requireCodeOwners: true
      requireLastPushApproval: true

      # Status checks
      requiredStatusChecks:
        strict: true # require branch up-to-date
        checks:
          - ci/build
          - ci/test

      # Restrictions
      enforceAdmins: true
      requiredLinearHistory: true
      allowForcePushes: false
      allowDeletions: false
      requiredConversationResolution: true

      # Signatures
      requiredSignatures: false

    "release/*": # Pattern matching supported
      enforceAdmins: true
      requiredReviews: 1
```

**Key points:**

- Branch names as keys (supports patterns like `release/*`)
- camelCase field names (JS convention, maps to GitHub's snake_case API)
- All fields optional - only specify what you want to enforce
- Unspecified fields left as-is on GitHub

### Orphan Handling

`deleteOrphaned` applies at the branch rule level, consistent with file behavior:

- **Branch rule in config** - Apply settings
- **Branch rule removed from config + `deleteOrphaned: true`** - Delete entire protection rule
- **Branch rule removed from config + `deleteOrphaned: false`** - Leave protection as-is (orphaned)

Individual fields within a rule are never removed - only entire rules.

### Manifest V3

Current V2 manifest is a flat array per config. V3 adds resource types:

```json
{
  "version": 3,
  "configs": {
    "my-config": {
      "files": [".github/dependabot.yml", "renovate.json"],
      "branchProtection": ["main", "develop"]
    }
  }
}
```

**Benefits:**

- Track each resource type independently
- Clear what xfg manages vs what it doesn't
- Extensible for future resource types
- `deleteOrphaned` can be scoped per resource type

**Migration:** V2 `string[]` automatically becomes `{ files: string[] }`.

### Authentication

Support both GitHub PAT and GitHub App:

- **PAT:** Use directly via `gh api`
- **App:** Use token from `GitHubAppTokenManager`, pass via `GH_TOKEN` env var

Same pattern as existing `graphql-commit-strategy.ts`.

### Dry-Run Output

Show diff of protection changes:

```
org/my-repo:
  main:
    + requiredReviews: 1 → 2
    + requireCodeOwners: false → true
    = dismissStaleReviews: true (unchanged)

org/other-repo:
  main: (no changes)
  develop:
    + NEW branch protection rule
```

### Error Handling

Continue on failure (consistent with file sync):

- Process all repos
- Report failures at end
- Exit code reflects any failures

## Architecture

### New Modules

| Module                                     | Purpose                                        |
| ------------------------------------------ | ---------------------------------------------- |
| `branch-protection-processor.ts`           | Orchestrates protection for all repos          |
| `strategies/github-protection-strategy.ts` | GitHub API calls for branch protection         |
| `protection-diff.ts`                       | Compare config vs current state, generate diff |

### Flow for `xfg protect`

```
1. Load config
2. For each repo:
   a. Resolve settings (deep merge root + repo-level)
   b. Fetch current protection from GitHub API
   c. Diff config vs current state
   d. If dry-run: display diff
   e. If not dry-run: apply changes via API
   f. If deleteOrphaned: remove rules not in config
3. Report results (same format as sync)
```

### GitHub API

```bash
# Get current protection
gh api /repos/{owner}/{repo}/branches/{branch}/protection

# Set protection
gh api -X PUT /repos/{owner}/{repo}/branches/{branch}/protection -f ...

# Delete protection
gh api -X DELETE /repos/{owner}/{repo}/branches/{branch}/protection
```

### Files to Create/Modify

| File                                           | Action                        |
| ---------------------------------------------- | ----------------------------- |
| `src/index.ts`                                 | Add subcommand structure      |
| `src/config.ts`                                | Add `settings` types          |
| `src/config-normalizer.ts`                     | Merge settings defaults       |
| `src/manifest.ts`                              | V3 schema with resource types |
| `src/branch-protection-processor.ts`           | NEW                           |
| `src/strategies/github-protection-strategy.ts` | NEW                           |
| `src/protection-diff.ts`                       | NEW                           |
| `config-schema.json`                           | Add settings schema           |

## Phase 1 Scope (This Implementation)

**In scope:**

- `xfg protect` subcommand (GitHub only)
- `settings.branchProtection` in config (root + per-repo)
- Deep merge with root-level defaults
- Manifest V3 for tracking managed protection rules
- `deleteOrphaned` support for removing unmanaged rules
- Dry-run with diff output
- GitHub PAT and App authentication support

**Out of scope:**

- `xfg sync` refactor to explicit subcommand (bare `xfg` stays as sync)
- Repo creation
- Fork management
- Other settings (`features`, `mergeOptions`, `security`)
- Azure DevOps / GitLab support

## Future Phases

### Phase 2: Declarative Repo Management

Repo creation and fork management through declarative config:

```yaml
repos:
  # Repo doesn't exist → create it
  - git: "org/new-service"
    settings:
      description: "New microservice"
      visibility: private
      topics: [typescript, api]
      branchProtection:
        main: { requiredReviews: 1 }

  # Has upstream → fork semantics
  # Fork doesn't exist → create fork
  - git: "myorg/forked-lib"
    upstream: "original-org/lib"
    settings:
      description: "My fork of lib"
      branchProtection:
        main: { requiredReviews: 1 }
```

**Logic:**

- `upstream` present → fork semantics
- Repo missing + no upstream → create new repo
- Repo missing + upstream → fork it
- Repo exists → apply settings

True infrastructure-as-code: declare desired state, xfg reconciles.

### Phase 3: Comprehensive Settings

Add support for all repo settings:

```yaml
settings:
  # Basic
  description: "..."
  visibility: private
  topics: [typescript, api]
  homepage: "https://..."

  # Features
  features:
    issues: true
    wiki: false
    projects: false
    discussions: false

  # Merge behavior
  mergeOptions:
    allowSquash: true
    allowMerge: false
    allowRebase: false
    deleteBranchOnMerge: true
    allowAutoMerge: true

  # Security
  security:
    vulnerabilityAlerts: true
    dependabotSecurityUpdates: true
    secretScanning: true

  # Branch protection (Phase 1)
  branchProtection: { ... }
```

### Phase 4: Multi-Platform Support

Extend protection strategies for Azure DevOps and GitLab:

| Feature          | GitHub | Azure DevOps   | GitLab          |
| ---------------- | ------ | -------------- | --------------- |
| Required reviews | Yes    | Yes (policies) | Yes             |
| Status checks    | Yes    | Yes (policies) | Yes (pipelines) |
| Force push       | Yes    | Yes            | Yes             |
| Linear history   | Yes    | Limited        | Yes             |

Each platform gets its own strategy implementation mapping the common config to platform-specific APIs.

## CLI Reference

### `xfg protect`

```bash
# Apply branch protection from config
xfg protect -c config.yaml

# Dry-run - show what would change
xfg protect -c config.yaml --dry-run

# Skip orphan deletion
xfg protect -c config.yaml --no-delete
```

### Shared Flags

| Flag                     | Description                      |
| ------------------------ | -------------------------------- |
| `-c, --config <path>`    | Config file (required)           |
| `-d, --dry-run`          | Preview changes without applying |
| `-w, --work-dir <path>`  | Temp directory                   |
| `-r, --retries <number>` | Network retry count              |
| `--no-delete`            | Skip orphan deletion             |
