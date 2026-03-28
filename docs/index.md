# xfg

Manage files, settings, and repositories across GitHub, Azure DevOps, and GitLab — declaratively, from a single YAML config.

Define your organization's standards once. xfg creates PRs to sync config files, applies repository settings and rulesets via API, and can even create, fork, or migrate repositories — all from one config file.

## Quick Start

```bash
# Install
npm install -g @aspruyt/xfg

# Authenticate (GitHub)
gh auth login

# Sync files, settings, rulesets, and labels across repos
xfg sync --config ./config.yaml
```

### Example Config

```yaml
id: my-org-standards

files:
  .prettierrc.json:
    content:
      semi: false
      singleQuote: true
      tabWidth: 2

  ".github/workflows/ci.yaml":
    content:
      name: CI
      on: [push, pull_request]
      jobs:
        build:
          runs-on: ubuntu-latest
          steps:
            - uses: actions/checkout@v4
            - run: npm ci && npm test

settings:
  repo:
    allowSquashMerge: true
    deleteBranchOnMerge: true
    vulnerabilityAlerts: true
    secretScanning: true

  rulesets:
    main-protection:
      target: branch
      enforcement: active
      conditions:
        refName:
          include: [refs/heads/main]
          exclude: []
      rules:
        - type: pull_request
          parameters:
            requiredApprovingReviewCount: 1
        - type: required_status_checks
          parameters:
            requiredStatusChecks:
              - context: "ci/build"

repos:
  - git:
      - git@github.com:your-org/frontend-app.git
      - git@github.com:your-org/backend-api.git
      - git@github.com:your-org/shared-lib.git
```

**Result:** PRs are created with `.prettierrc.json` and CI workflow files, repos get standardized merge options, security settings, and branch protection rulesets.

## Features

### File Sync (`xfg sync`)

- **Multi-Format Output** - JSON, JSON5, YAML, or plain text based on filename extension
- **Subdirectory Support** - Sync files to any path (e.g., `.github/workflows/ci.yaml`)
- **Text Files** - Sync `.gitignore`, `.editorconfig`, shell scripts, etc.
- **File References** - Use `@path/to/file` to load content from external template files
- **Content Inheritance** - Define base config once, [override per-repo](configuration/inheritance.md) as needed
- **Flexible Opt-Out** - Exclude specific files per-repo, or use [`inherit: false`](configuration/inheritance.md#skipping-all-inherited-files) to skip all inherited files
- **Environment Variables** - Use `${VAR}`, `${VAR:-default}`, or `${VAR:?error}` for dynamic values
- **Merge Strategies** - Control how arrays merge ([replace, append, prepend](configuration/merge-strategies.md))
- **Orphan Deletion** - Remove files from repos when [removed from config](configuration/index.md#delete-orphaned-files)
- **YAML Comments** - Add [header comments and schema directives](configuration/content-types.md#yaml-comments) to YAML files
- **Empty Files** - Create files with no content (e.g., `.prettierignore`)
- **Create-Only Mode** - Only create files if they don't exist, never overwrite

### Templating (`${xfg:...}`)

Generate repo-specific content from a single template using [xfg template variables](configuration/templating.md):

```yaml
files:
  README.md:
    template: true
    vars:
      team: platform
    content: |
      # ${xfg:repo.name}
      Owned by ${xfg:team} | Platform: ${xfg:repo.platform}
```

**Built-in variables:** `repo.name`, `repo.owner`, `repo.fullName`, `repo.url`, `repo.platform`, `repo.host`, `file.name`, `date`

**Custom variables:** Define with `vars`, override per-repo.

### Repository Settings

Manage [GitHub repository settings](configuration/repo-settings.md) declaratively:

- **Merge Options** - Squash, rebase, merge commit strategies; auto-delete branches; commit title/message format
- **Security** - Dependabot alerts, automated security fixes, secret scanning, push protection, private vulnerability reporting
- **Feature Toggles** - Issues, Wiki, Projects, Discussions, template repos, forking
- **Visibility** - Public, private, or internal
- **Terraform-Style Diff** - Preview changes with `+`/`~`/`-` indicators in dry-run mode
- **Opt-Out** - Use `repo: false` per-repo to skip settings for specific repos

### GitHub Rulesets

Manage [GitHub Rulesets](configuration/rulesets.md) as code:

- **20+ Rule Types** - pull_request, status_checks, signatures, code_scanning, workflows, pattern rules, file restrictions, and more
- **Bypass Actors** - Fine-grained control over which teams, users, or apps can bypass rules
- **Pattern Conditions** - Apply rules to branches/tags matching glob patterns
- **Evaluate Mode** - Test rules without enforcement
- **Inheritance** - Define defaults at root, override or [opt out](configuration/rulesets.md#single-ruleset-opt-out) per-repo
- **Orphan Deletion** - Automatically remove rulesets no longer in config

### Repo Lifecycle Management

Automatically [create, fork, or migrate](configuration/lifecycle.md) repositories before syncing:

```yaml
repos:
  # Create a new repo (if it doesn't exist)
  - git: git@github.com:my-org/new-service.git

  # Fork an open-source project
  - git: git@github.com:my-org/our-eslint-config.git
    upstream: git@github.com:airbnb/javascript.git

  # Migrate from Azure DevOps to GitHub
  - git: git@github.com:my-org/migrated-api.git
    source: https://dev.azure.com/myorg/legacy/_git/old-api
```

- **Auto-Create** - New repos created with configured settings (visibility, description, features)
- **Fork** - Fork upstream repos into your org or personal account (GitHub only)
- **Migrate** - Mirror-clone from Azure DevOps or GitLab to GitHub with all branches and tags
- **Dry-Run Support** - Preview lifecycle operations without executing them

### PR & Merge Options

Control how changes are delivered with [PR options](configuration/pr-options.md):

| Mode | Behavior |
| ---- | -------- |
| `auto` | Enable auto-merge — merge when checks pass (default) |
| `manual` | Leave PR open for manual review |
| `force` | Merge immediately, bypassing checks |
| `direct` | Push directly to default branch, no PR |

Merge strategies: `squash` (default), `merge`, `rebase`. Set globally, override per-repo, or override via CLI.

Customize PR descriptions with [PR templates](configuration/pr-templates.md) using `${xfg:pr.fileChanges}`, `${xfg:pr.fileCount}`, and other variables.

### Platform Support

| Feature | GitHub | Azure DevOps | GitLab |
| ------- | ------ | ------------ | ------ |
| File sync | Yes | Yes | Yes |
| Self-hosted | Yes (GHE) | Yes | Yes |
| Repo settings | Yes | - | - |
| Rulesets | Yes | - | - |
| Repo lifecycle | Yes | Source only | - |
| Auto-merge PRs | Yes | Yes | Yes |
| Direct push | Yes | Yes | Yes |

### Enterprise & CI/CD

- **[GitHub App Authentication](platforms/github-app.md)** - No user-tied credentials, fine-grained permissions, and verified commits with the "Verified" badge
- **GitHub Enterprise Server** - Configure custom hostnames via `githubHosts` in config
- **[GitHub Actions](ci-cd/github-actions.md)** - Official action (`anthony-spruyt/xfg@v5`) with all options as inputs
- **[Azure Pipelines](ci-cd/azure-pipelines.md)** - Run xfg in Azure DevOps pipelines
- **CI Summary Output** - Rich `GITHUB_STEP_SUMMARY` with diff-style change reports:

```text
## xfg Apply

  @@ your-org/frontend @@
  + .prettierrc.json
  ! .github/workflows/ci.yaml
  + ruleset "main-protection"

  @@ your-org/backend @@
  + .prettierrc.json
  + allowAutoMerge: true
  ! deleteBranchOnMerge: false → true

**Applied: 4 files (2 created, 2 updated), 1 ruleset (1 created), 2 settings (1 added, 1 changed)**
```

- **Dry-Run Mode** - Preview all changes without applying them (`--dry-run`)
- **Error Resilience** - Continues processing if individual repos fail
- **Automatic Retries** - Retries transient network errors with exponential backoff
- **[IDE Integration](ide-integration.md)** - JSON Schema for VS Code autocomplete and validation

## How It Works

### Sync Workflow (`xfg sync`)

```mermaid
flowchart TB
    subgraph Loading["Config Loading"]
        INPUT{{"File or directory?"}} -->|File| YAML[/"YAML Config File"/]
        INPUT -->|Directory| DIR["Load all *.yaml/*.yml<br/>(alphabetical order)"]
        DIR --> MERGE_CFG["Merge fragments<br/>(single-file keys exclusive,<br/>groups by name, repos concat)"]
        MERGE_CFG --> REFS["Resolve @file references<br/>(root, group & repo levels)"]
        YAML --> REFS
        REFS --> VALIDATE["Validate structure"]
        VALIDATE --> VALIDATE_CMD_S["Validate for sync<br/>(require files to sync)"]
    end

    subgraph Normalization
        EXPAND["Expand git arrays"] --> EXTENDS["Resolve group extends<br/>(expand parent chains)"]
        EXTENDS --> GROUPS["Merge group layers per-repo<br/>(files, prOptions, settings)<br/>root → group1 → group2 → …"]
        GROUPS --> COND["Evaluate conditional groups<br/>(merge matching conditionalGroups<br/>in array order)"]
        COND --> MERGE["Merge per-repo overrides<br/>(deep merge / text merge / override)"]
        MERGE --> ENV["Interpolate env vars<br/><code>${VAR}</code>, <code>${VAR:-default}</code>"]
        ENV --> OPTS["Resolve per-repo fields<br/>(createOnly, executable,<br/>template, vars, etc.)"]
    end

    subgraph ForEach["For Each Repository"]
        LIFECYCLE{"Repo exists?"} -->|Yes| SYNC
        LIFECYCLE -->|"No + upstream"| FORK["Fork from upstream"] --> SYNC
        LIFECYCLE -->|"No + source"| MIGRATE["Mirror-clone & push"] --> SYNC
        LIFECYCLE -->|No| CREATE["Create empty repo"] --> SYNC
        SYNC["Per-Repo Sync Workflow<br/><i>(see detail below)</i>"]
    end

    SUMMARY["Generate CI Summary Report"]

    VALIDATE_CMD_S --> EXPAND
    OPTS --> ForEach
    ForEach --> SUMMARY
```

#### Per-Repository Detail

```mermaid
flowchart TB
    AUTH["Resolve auth<br/>(GitHub App token / PAT)"] --> AUTH_CHECK{Auth available?}
    AUTH_CHECK -->|No| SKIP_AUTH["Skip repo"]
    AUTH_CHECK -->|Yes| MODE["Determine merge mode"]

    MODE --> SESSION["Clean workspace → Clone repo"]
    SESSION --> DETECT["Detect default branch"]

    DETECT --> MODE_CHECK{Direct mode?}
    MODE_CHECK -->|No| CLOSE["Close existing PR<br/>+ delete branch + prune"]
    CLOSE --> BRANCH["Create fresh branch"]
    MODE_CHECK -->|Yes| STAY["Stay on default branch"]

    BRANCH --> WRITE
    STAY --> WRITE

    subgraph FileSync["File Sync"]
        WRITE["Pass 1: Write each config file<br/>(xfg template interpolation,<br/>skip createOnly if exists on base)"]
        WRITE --> CHMOD["Pass 2: Set executable mode<br/>(git update-index --chmod=+x<br/>for all executable files)"]
        CHMOD --> ORPHANS["Detect & delete<br/>orphaned files"]
        ORPHANS --> MANIFEST["Update manifest<br/>(.xfg.json)"]
    end

    MANIFEST --> CHANGES_CHECK{Any file changes?}
    CHANGES_CHECK -->|No| SKIP_NC_EARLY["Skip — no changes"]
    CHANGES_CHECK -->|Yes| DRY{Dry run?}
    DRY -->|Yes| DRY_SHOW["Show diff summary ✓"]
    DRY -->|No| STAGE["git add -A"]
    STAGE --> STAGED{Staged changes?}
    STAGED -->|No| SKIP_NC["Skip — no changes"]
    STAGED -->|Yes| COMMIT_SELECT{"GitHub +<br/>App credentials?"}
    COMMIT_SELECT -->|Yes| GQL_BRANCH["Ensure remote branch<br/>(createRef / deleteRef<br/>GraphQL mutations)"]
    GQL_BRANCH --> GQL["GraphQL commit<br/>(createCommitOnBranch —<br/>verified / signed)"]
    COMMIT_SELECT -->|No| GIT["Git commit & push"]

    GQL --> DIRECT_CHECK
    GIT --> DIRECT_CHECK

    DIRECT_CHECK{Direct mode?}
    DIRECT_CHECK -->|Yes| DONE["Done — on default branch ✓"]
    DIRECT_CHECK -->|No| PR_CREATE

    subgraph PR["PR Creation & Merge"]
        PR_CREATE["Create PR<br/>(gh / az / glab)"]
        PR_CREATE --> MERGE_MODE{Merge mode?}
        MERGE_MODE -->|auto| AUTO_CHECK{"auto-merge<br/>enabled on repo?"}
        AUTO_CHECK -->|Yes| AUTO["Enable auto-merge"]
        AUTO_CHECK -->|No| WARN["Warn & leave open"]
        MERGE_MODE -->|force| FORCE["Bypass & merge"]
        MERGE_MODE -->|manual| OPEN["Leave PR open"]
    end
```

### Settings Workflow

```mermaid
flowchart TB
    subgraph Loading["Config Loading"]
        INPUT{{"File or directory?"}} -->|File| YAML[/"YAML Config File"/]
        INPUT -->|Directory| DIR["Load all *.yaml/*.yml<br/>(alphabetical order)"]
        DIR --> MERGE_CFG["Merge fragments"]
        MERGE_CFG --> REFS["Resolve @file references"]
        YAML --> REFS
        REFS --> VALIDATE["Validate structure"]
        VALIDATE --> VALIDATE_CMD["Validate for sync"]
    end

    subgraph Normalization
        EXPAND["Expand git arrays"] --> EXTENDS_S["Resolve group extends<br/>(expand parent chains)"]
        EXTENDS_S --> GROUPS_S["Merge group layers per-repo<br/>(files, prOptions, settings)<br/>root → group1 → group2 → …"]
        GROUPS_S --> COND_S["Evaluate conditional groups<br/>(merge matching conditionalGroups<br/>in array order)"]
        COND_S --> MERGE_S["Merge per-repo overrides<br/>(deep merge / text merge / override)"]
        MERGE_S --> ENV_S["Interpolate env vars<br/><code>${VAR}</code>, <code>${VAR:-default}</code>"]
        ENV_S --> OPTS_S["Resolve per-repo fields<br/>(createOnly, executable,<br/>template, vars, etc.)"]
    end

    subgraph Lifecycle["Lifecycle Pre-Check (all unique repos)"]
        EXIST{"Repo exists?"} -->|Yes| READY["Ready"]
        EXIST -->|"No + upstream"| FORK["Fork"] --> READY
        EXIST -->|"No + source"| MIGRATE["Migrate"] --> READY
        EXIST -->|No| CREATE["Create with settings"] --> READY
    end

    subgraph Phase1["Phase 1: Rulesets"]
        RS["For each repo with rulesets<br/><i>(see detail below)</i>"]
    end

    subgraph Phase2["Phase 2: Repo Settings"]
        REPO["For each repo with repo settings<br/><i>(see detail below)</i>"]
    end

    subgraph Phase3["Phase 3: Labels"]
        LBL["For each repo with labels<br/><i>(see detail below)</i>"]
    end

    subgraph Phase4["Phase 4: Code Scanning"]
        CS["For each repo with codeScanning<br/><i>(see detail below)</i>"]
    end

    REPORT["Generate Summary Report"]

    VALIDATE_CMD --> EXPAND
    OPTS_S --> Lifecycle
    Lifecycle --> Phase1
    Phase1 --> Phase2
    Phase2 --> Phase3
    Phase3 --> Phase4
    Phase4 --> REPORT
```

#### Ruleset Processing (per repo)

```mermaid
flowchart TB
    GUARD{GitHub repo?} -->|No| SKIP_P["Skip (GitHub only)"]
    GUARD -->|Yes| FETCH_MANIFEST["Fetch remote manifest<br/>(.xfg.json)"]

    FETCH_MANIFEST --> TOKEN["Resolve auth token"]

    TOKEN --> LIST["List current rulesets<br/>(summary only)"]
    LIST --> HYDRATE["Hydrate matching rulesets<br/>(full detail: conditions,<br/>rules, bypass_actors)"]

    HYDRATE --> DIFF["Diff: create / update /<br/>delete / unchanged"]
    DIFF --> PLAN["Format terraform-style plan"]
    PLAN --> DRY{Dry run?}
    DRY -->|Yes| SHOW["Show plan ✓"]
    DRY -->|No| APPLY

    subgraph APPLY["Apply Changes"]
        direction TB
        C["POST — create new rulesets"]
        U["PUT — update changed rulesets"]
        D["DELETE — remove orphaned<br/>(if deleteOrphaned)"]
    end

    APPLY --> DONE["Done ✓"]
```

#### Repo Settings Processing (per repo)

```mermaid
flowchart TB
    GUARD{GitHub repo?} -->|No| SKIP_P["Skip (GitHub only)"]
    GUARD -->|Yes| TOKEN["Resolve auth token"]

    TOKEN --> FETCH

    subgraph FETCH["Fetch Current State (4 API calls)"]
        direction TB
        F1["GET /repos — main settings<br/>(includes security_and_analysis)"]
        F2["GET vulnerability-alerts"]
        F3["GET automated-security-fixes"]
        F4["GET private-vulnerability-reporting"]
    end

    FETCH --> SEC_VAL{"Security settings<br/>valid for visibility /<br/>owner / GHAS?"}
    SEC_VAL -->|No| SEC_ERR["Error — abort repo"]
    SEC_VAL -->|Yes| DIFF["Diff: add / change"]

    DIFF --> CHANGES{Changes needed?}
    CHANGES -->|No| SKIP_NC["Skip — already matches ✓"]
    CHANGES -->|Yes| PLAN["Format terraform-style plan<br/>(warn on high-impact changes)"]
    PLAN --> DRY{Dry run?}
    DRY -->|Yes| SHOW["Show plan ✓"]
    DRY -->|No| APPLY

    subgraph APPLY["Apply (ordered)"]
        direction TB
        A1["PATCH /repos — main settings"]
        A2["PUT/DELETE vulnerability-alerts"]
        A3["PUT/DELETE private-vuln-reporting"]
        A4["PUT/DELETE automated-security-fixes<br/>(last — depends on vuln-alerts)"]
    end

    APPLY --> DONE["Done ✓"]
```

#### Labels Processing (per repo)

```mermaid
flowchart TB
    GUARD{GitHub repo?} -->|No| SKIP_P["Skip (GitHub only)"]
    GUARD -->|Yes| FETCH_MANIFEST["Fetch remote manifest<br/>(.xfg.json)"]

    FETCH_MANIFEST --> TOKEN["Resolve auth token"]
    TOKEN --> LIST["List current labels"]

    LIST --> DIFF["Diff: create / update /<br/>delete / unchanged"]
    DIFF --> PLAN["Format terraform-style plan"]
    PLAN --> DRY{Dry run?}
    DRY -->|Yes| SHOW["Show plan ✓"]
    DRY -->|No| APPLY

    subgraph APPLY["Apply Changes (ordered)"]
        direction TB
        D["DELETE — remove orphaned<br/>(if deleteOrphaned)"]
        U["PUT — update changed labels"]
        C["POST — create new labels"]
    end

    APPLY --> DONE["Done ✓"]
```

#### Code Scanning Processing (per repo)

```mermaid
flowchart TB
    GUARD{GitHub repo?} -->|No| SKIP_P["Skip (GitHub only)"]
    GUARD -->|Yes| TOKEN["Resolve auth token"]

    TOKEN --> META["Fetch repo metadata<br/>(visibility, owner type, GHAS)"]
    META --> GHAS{Private/internal<br/>+ GHAS enabled?}
    GHAS -->|"Private + no GHAS"| GHAS_ERR["Error — GHAS required"]
    GHAS -->|"Public or GHAS ok"| FETCH["GET code-scanning/default-setup"]

    FETCH --> DIFF["Diff: state / querySuite /<br/>languages"]
    DIFF --> CHANGES{Changes needed?}
    CHANGES -->|No| SKIP_NC["Skip — already matches ✓"]
    CHANGES -->|Yes| PLAN["Format terraform-style plan"]
    PLAN --> DRY{Dry run?}
    DRY -->|Yes| SHOW["Show plan ✓"]
    DRY -->|No| APPLY["PATCH code-scanning/default-setup"]

    APPLY --> DONE["Done ✓"]
```

**See [Use Cases](use-cases.md)** for real-world scenarios: platform engineering, CI/CD standardization, security governance, repo migration, and more.
