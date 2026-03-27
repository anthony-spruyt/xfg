# Code Scanning Default Setup via Settings

**Issue:** #669
**Date:** 2026-03-27

## Problem

xfg can require CodeQL results via rulesets (`code_scanning` rule type) but cannot **enable** code scanning itself through settings configuration. Users must enable it manually via the GitHub UI, API, or by committing a workflow file. This is the last gap in security settings coverage — secret scanning, vulnerability alerts, Dependabot, and private vulnerability reporting are all configurable.

## Config Shape

New `codeScanning` section as a sibling to `repo`, `labels`, and `rulesets` under `settings`:

```yaml
settings:
  codeScanning:
    state: configured        # required: "configured" | "not-configured"
    querySuite: extended     # optional: "default" | "extended"
    languages:               # optional: auto-detect if omitted
      - javascript-typescript
      - python
```

### Design Decisions

- **Sibling, not nested under `repo`** — `repo` is flat key-value pairs (booleans, strings, enums). Complex structured settings (`labels`, `rulesets`) are siblings. Code scanning is structured, so it follows the sibling pattern.
- **Direct API mapping for `state`** — uses `"configured" | "not-configured"` from the GitHub API rather than a boolean. KISS — no translation layer, schema gives autocomplete/validation.
- **`languages` is optional** — if omitted, GitHub auto-detects. Only diff state/querySuite when languages is not specified.
- **`querySuite` is optional** — if omitted, don't diff it. Only apply what's explicitly configured.

### Supported Languages (schema enum)

- `actions`
- `c-cpp`
- `csharp`
- `go`
- `java-kotlin`
- `javascript-typescript`
- `python`
- `ruby`
- `swift`

## Architecture

### Approach: Dedicated Processor (like labels/rulesets)

New `src/settings/code-scanning/` module with its own processor, strategy, diff, and formatter. This follows SOLID:

- **SRP** — code scanning processor handles code scanning only
- **OCP** — adding code scanning means adding a new processor, not modifying existing ones
- **ISP** — `IRepoSettingsStrategy` doesn't get unrelated methods
- **DIP** — new processor depends on its own strategy interface, injected via constructor

### Module Structure

| File | Purpose |
| ---- | ------- |
| `types.ts` | `ICodeScanningStrategy` interface, `CurrentCodeScanningSettings` type |
| `github-code-scanning-strategy.ts` | Strategy impl — GET/PUT on `/repos/{owner}/{repo}/code-scanning/default-setup` |
| `diff.ts` | Compare current vs desired, return changes list |
| `formatter.ts` | Format diff into plan output for dry-run display |
| `processor.ts` | `CodeScanningProcessor` — orchestrates get, diff, apply. Uses `withGitHubGuards` |
| `index.ts` | Barrel exports |

### Strategy Interface

```typescript
export interface ICodeScanningStrategy {
  getDefaultSetup(
    repoInfo: RepoInfo,
    options?: GhApiOptions
  ): Promise<CurrentCodeScanningSettings>;

  updateDefaultSetup(
    repoInfo: RepoInfo,
    settings: CodeScanningSettings,
    options?: GhApiOptions
  ): Promise<void>;
}
```

### Shared Repo Metadata Provider

Extract a new `IRepoMetadataProvider` to share repo metadata (visibility, owner type, GHAS availability) between `RepoSettingsProcessor` and `CodeScanningProcessor`:

```typescript
export interface IRepoMetadataProvider {
  getMetadata(
    repoInfo: RepoInfo,
    options?: GhApiOptions
  ): Promise<RepoMetadata>;
}

export interface RepoMetadata {
  visibility: RepoVisibility;
  ownerType: "User" | "Organization";
  hasGHAS: boolean;
}
```

- `GitHubRepoMetadataProvider` fetches from `GET /repos/{owner}/{repo}` and derives `hasGHAS` from `security_and_analysis != null`
- Injected into both `RepoSettingsProcessor` and `CodeScanningProcessor` via constructor
- Refactors `RepoSettingsProcessor.validateSecuritySettings` to use the shared provider instead of inline GHAS detection from the repo response
- Testable via mock injection

### Diff Logic

Three properties to compare:

- **`state`** — string comparison, always diffed (required field)
- **`querySuite`** — string comparison, only diffed if specified in config
- **`languages`** — sorted array comparison (order doesn't matter to API), only diffed if specified in config

### Validation & Guards

- **GitHub-only** — ADO/GitLab repos skipped via existing `withGitHubGuards`
- **GHAS requirement** — for private/internal repos, code scanning requires GitHub Advanced Security. The processor checks `IRepoMetadataProvider.getMetadata()` for `hasGHAS` and returns a clear error if unavailable, same pattern as `validateSecuritySettings` in repo settings today

## Wiring into Orchestrator

Following the existing pattern in `sync-command.ts`:

1. **New factory type** — `CodeScanningProcessorFactory` in `types.ts`
2. **Default factory** — `createDefaultCodeScanningProcessorFactory()` in `sync-command.ts`
3. **New descriptor** — added to `buildSettingsDescriptors()` with `key: "codeScanning"`, `label: "Code Scanning"`
4. **Results** — `ProcessorResults` gets `codeScanningResult`, wired into summary output

## Files Changed

| Area | What changes |
| ---- | ------------ |
| `src/config/types.ts` | New `CodeScanningSettings` interface, add `codeScanning?` to `RepoSettings`, `RawRootSettings`, and `RawRepoSettings` |
| `config-schema.json` | New `codeScanningSettings` definition with language enum, `codeScanning` property under `settings` |
| `src/shared/` (new) | `IRepoMetadataProvider` interface + `GitHubRepoMetadataProvider` impl |
| `src/settings/code-scanning/` (new) | `types.ts`, `github-code-scanning-strategy.ts`, `diff.ts`, `formatter.ts`, `processor.ts`, `index.ts` |
| `src/settings/index.ts` | Export new code scanning module |
| `src/settings/repo-settings/processor.ts` | Refactor to use injected `IRepoMetadataProvider` instead of inline GHAS check |
| `src/cli/types.ts` | New `CodeScanningProcessorFactory`, `codeScanningResult` on `ProcessorResults` |
| `src/cli/sync-command.ts` | New factory + descriptor in `buildSettingsDescriptors` |
| `src/config/validator.ts` | Validate `codeScanning` settings |
| Tests | Unit tests for diff/processor/strategy, integration test for GitHub |
| Docs | Update settings documentation with code scanning section |

## Testing Strategy

### Unit Tests

- `code-scanning-processor.test.ts` — mock strategy + metadata provider, test diff/apply/dry-run/validation flows
- `code-scanning-diff.test.ts` — pure function tests for state/querySuite/languages diffing
- `github-code-scanning-strategy.test.ts` — mock `GhApiClient`, verify correct endpoints/payloads

### Integration Test

Add code scanning config to the existing GitHub settings integration test flow. Enable/disable default setup on an ephemeral repo, verify state via API.

### Key Test Cases

- Configure from scratch (not-configured → configured)
- Change query suite (default → extended)
- Change languages
- Disable (configured → not-configured)
- No changes needed (idempotent)
- GHAS not available on private repo → clear error
- Dry run shows plan without applying
- Languages omitted → only diff state/querySuite
