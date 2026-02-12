# Repo Lifecycle Management Design

## Overview

Extend xfg to manage repository lifecycle operations: **create**, **fork**, and **migrate** repositories declaratively via config. Currently xfg assumes repos exist - this feature enables onboarding new repos into the xfg-managed ecosystem.

## Use Cases

1. **Create from scratch** - Spin up new empty repos with baseline config and settings
2. **Fork + onboard** - Fork an upstream OSS repo into your org for customization/patching
3. **Migrate** - Move existing repos from one platform to another (e.g., ADO to GitHub)

## Config Schema

The config schema extends the existing `repos` structure with optional fields that signal intent:

```yaml
settings:
  repo:
    visibility: private
    description: "Managed by xfg"
    deleteBranchOnMerge: true
    # ... other settings applied to all repos

repos:
  # Existing repo - sync only (current behavior)
  - git: git@github.com:my-org/existing-service.git

  # New repo - create if missing, then sync
  - git: git@github.com:my-org/new-service.git

  # Fork - fork upstream if missing, then sync
  - git: git@github.com:my-org/forked-tool.git
    upstream: git@github.com:opensource/cool-tool.git

  # Migrate - create from ADO source if missing, then sync
  - git: git@github.com:my-org/migrated-app.git
    source: https://dev.azure.com/org/project/_git/legacy-app
```

### Schema Validation

- `upstream` and `source` are mutually exclusive (cannot have both)
- `upstream` must be a valid git URL
- `source` must be a valid git URL from a supported source platform

### Resolution Logic

Evaluated per-repo:

1. Check if target repo (`git`) exists
2. If exists → proceed to sync/settings as normal (ignore `upstream`/`source`)
3. If missing:
   - `source` present → migrate from source platform
   - `upstream` present → fork from upstream
   - Neither → create empty repo
4. Apply `settings.repo` to newly created repo
5. Proceed with file sync / settings as normal

## Command Behavior

Both `xfg sync` and `xfg settings` can trigger lifecycle operations. The dry-run serves as the safety mechanism:

```bash
# Step 1: See the plan
xfg sync --config config.yaml --dry-run

# Step 2: Review, then apply
xfg sync --config config.yaml
```

### Dry-Run Output

```
+ CREATE github.com/my-org/new-service
    description: "Managed by xfg"
    visibility: private
    deleteBranchOnMerge: true

+ FORK github.com/opensource/tool → github.com/my-org/forked-tool
    description: "Managed by xfg"
    visibility: private

+ MIGRATE dev.azure.com/.../legacy-app → github.com/my-org/migrated-app
    description: "Migrated from ADO"
    visibility: private
    branches: 4
    tags: 12

~ SYNC github.com/my-org/existing-repo
    + .prettierrc.json
    ~ .eslintrc.json
    - deprecated-config.yaml
```

## Architecture

### Interfaces

```typescript
// Core abstraction for repo lifecycle operations
interface IRepoLifecycleProvider {
  readonly platform: "github" | "ado" | "gitlab";

  // Check if repo exists on this platform
  exists(repoInfo: RepoInfo): Promise<boolean>;

  // Create empty repo
  create(repoInfo: RepoInfo, settings: RepoSettings): Promise<void>;

  // Fork from upstream (optional - not all platforms support)
  fork?(upstream: RepoInfo, target: RepoInfo): Promise<void>;

  // Push migrated content to this platform
  receiveMigration(repoInfo: RepoInfo, settings: RepoSettings): Promise<void>;
}

// Source-side abstraction for migrations
interface IMigrationSource {
  readonly platform: "github" | "ado" | "gitlab";

  // Clone all branches/tags to local working directory
  cloneForMigration(repoInfo: RepoInfo, workDir: string): Promise<void>;
}

// Factory to get provider by platform
interface IRepoLifecycleFactory {
  getProvider(platform: string): IRepoLifecycleProvider;
  getMigrationSource(platform: string): IMigrationSource;
}
```

### Orchestration

```typescript
interface IRepoLifecycleManager {
  /**
   * Ensure repo exists, creating/forking/migrating if needed.
   * Returns the repo info (potentially updated) ready for sync.
   */
  ensureRepo(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: { dryRun: boolean; workDir: string }
  ): Promise<LifecycleResult>;
}

interface LifecycleResult {
  repoInfo: RepoInfo;
  action: "existed" | "created" | "forked" | "migrated";
  skipped?: boolean; // true if dry-run
}
```

### Integration Point

```typescript
// In sync/settings command (simplified)
async function processRepo(repoConfig, options) {
  const repoInfo = detectRepoInfo(repoConfig.git);

  // NEW: Ensure repo exists first
  const lifecycle = await lifecycleManager.ensureRepo(
    repoConfig,
    repoInfo,
    options
  );

  if (lifecycle.action !== "existed") {
    log.info(`${lifecycle.action} repo: ${repoInfo.gitUrl}`);
  }

  // EXISTING: Process as normal
  return repositoryProcessor.process(repoConfig, lifecycle.repoInfo, options);
}
```

## Platform Support

### Initial Scope

| Platform | Target (create/fork/receive) | Source (migrate from) |
| -------- | ---------------------------- | --------------------- |
| GitHub   | Yes                          | Future                |
| ADO      | Future                       | Yes                   |
| GitLab   | Future                       | Future                |

### Initial Implementations

- `GitHubLifecycleProvider` - Full implementation (create, fork, receiveMigration)
- `AdoMigrationSource` - Migration source only (cloneForMigration)

Adding new platforms means implementing the interfaces without touching existing code.

## Operation Details

### Create (empty repo)

When `git` only is present and target doesn't exist:

1. Create empty repo on GitHub via `gh repo create`
2. Apply `settings.repo` (visibility, description, etc.)
3. Proceed with normal sync/settings

### Fork

When `upstream` is present and target doesn't exist:

1. Fork via GitHub CLI: `gh repo fork <upstream> --org <target-org> --fork-name <name>`
2. Apply `settings.repo` to the new fork
3. Proceed with normal sync/settings

GitHub's fork preserves:

- All branches from upstream
- Full commit history
- Fork relationship (visible in GitHub UI)

### Migrate

When `source` is present and target doesn't exist:

1. Create target repo on GitHub (empty, with `settings.repo` applied)
2. Clone source repo with all refs: `git clone --mirror <source>`
3. Push all content to target: `git push --mirror <target>`
4. Proceed with normal sync/settings

What gets migrated:

- All branches
- All tags
- Full commit history

**Not migrated** (platform-specific, out of scope):

- Issues
- Pull requests
- Wikis
- CI/CD configuration

```bash
# Under the hood (simplified)
gh repo create my-org/migrated-app --private
git clone --mirror https://dev.azure.com/org/project/_git/legacy-app ./temp
cd ./temp
git push --mirror git@github.com:my-org/migrated-app.git
```

## Error Handling

### Error Scenarios

| Scenario                                            | Behavior                                                |
| --------------------------------------------------- | ------------------------------------------------------- |
| Target exists, `upstream`/`source` present          | Skip lifecycle, proceed to sync (idempotent)            |
| Source repo doesn't exist                           | Fail with clear error: "Source repo not found: ..."     |
| Upstream repo doesn't exist                         | Fail with clear error: "Upstream repo not found: ..."   |
| No permission to create on target org               | Fail with auth error, skip this repo, continue others   |
| Migration partially fails (created but push failed) | Log error, leave repo in created state, continue others |
| Fork fails (upstream is private, no access)         | Fail with permission error, continue others             |

### Multi-Repo Behavior

Consistent with existing xfg behavior - failures are logged but don't stop the entire run:

```
Results:
  ✓ 3 repos synced
  + 1 repo created
  + 1 repo migrated
  ✗ 1 repo failed: Permission denied creating github.com/other-org/repo
```

### Retry Behavior

Lifecycle operations use the same retry logic as existing git operations - configurable retries for transient network failures.

## New Components Summary

| Component                 | Purpose                                      |
| ------------------------- | -------------------------------------------- |
| `IRepoLifecycleProvider`  | Platform abstraction for create/fork/receive |
| `IMigrationSource`        | Platform abstraction for migration source    |
| `IRepoLifecycleFactory`   | Factory for providers                        |
| `RepoLifecycleManager`    | Orchestrates lifecycle before sync/settings  |
| `GitHubLifecycleProvider` | GitHub implementation                        |
| `AdoMigrationSource`      | ADO migration source implementation          |

## Future Considerations

- **Upstream tracking (B)**: Store upstream URL in manifest, report "upstream is N commits ahead"
- **GitLab support**: Implement `GitLabLifecycleProvider`
- **ADO as target**: Implement full `AdoLifecycleProvider`
- **GitHub as migration source**: Implement `GitHubMigrationSource`
- **LFS support**: Handle Git LFS content during migration
- **Large repo handling**: Progress reporting, chunked operations for very large repos
