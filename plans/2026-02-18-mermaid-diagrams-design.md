# Design: Rewrite Stale Mermaid Diagrams in docs/index.md

**Date:** 2026-02-18

## Problem

The two mermaid diagrams in `docs/index.md` (sync workflow and settings workflow) are stale and inaccurate compared to the actual codebase. Multiple steps are missing, some steps are in the wrong order, and the settings diagram collapses two independent processing phases into one.

## Approach

Replace both diagrams with an **overview + detail** structure:

- **Sync:** 1 overview diagram + 1 per-repo detail diagram
- **Settings:** 1 overview diagram + 2 detail diagrams (ruleset processing, repo settings processing)

This matches the actual code architecture (phases → per-repo loops) and gives readers both orientation and accuracy.

## Sync Diagram Issues Found

### Missing steps

1. `@file` reference resolution before normalization
2. Auth resolution as first per-repo step (can skip entire repo)
3. xfg template interpolation at write time (not during normalization)
4. Orphan detection & deletion after file writing
5. Manifest `.xfg.json` update committed alongside config files
6. Two commit strategies: Git (PAT) vs GraphQL (GitHub App, verified badge)
7. `auto` merge checks `allow_auto_merge` repo setting before enabling

### Structural issue

Direct mode push shown in PR subgraph but actually returns early from SyncWorkflow after commit — never enters PR logic.

## Settings Diagram Issues Found

### Missing steps

1. Two-pass validation: `validateRawConfig` + `validateForSettings`
2. Two separate processing phases: rulesets first, then repo settings
3. Security settings validation between fetch and diff
4. Ruleset two-pass fetch: summary list, then individual GET per match
5. Manifest update via full git clone+commit+PR for rulesets when `deleteOrphaned`

### Inaccurate

- Lifecycle only shows "Create Repo" but supports fork and migrate
- "Apply via GitHub API" is actually 4 separate ordered API calls for repo settings

## Approved Diagrams

### Sync Overview

```mermaid
flowchart TB
    subgraph Loading["Config Loading"]
        YAML[/"YAML Config File"/] --> REFS["Resolve @file references"]
        REFS --> VALIDATE["Validate structure"]
    end

    subgraph Normalization
        EXPAND["Expand git arrays"] --> MERGE["Merge base + overlay content"]
        MERGE --> ENV["Interpolate env vars<br/><code>${VAR}</code>, <code>${VAR:-default}</code>"]
        ENV --> OPTS["Resolve PR options &<br/>settings per-repo"]
    end

    subgraph ForEach["For Each Repository"]
        LIFECYCLE{"Repo exists?"} -->|Yes| SYNC
        LIFECYCLE -->|"No + upstream"| FORK["Fork from upstream"] --> SYNC
        LIFECYCLE -->|"No + source"| MIGRATE["Mirror-clone & push"] --> SYNC
        LIFECYCLE -->|No| CREATE["Create empty repo"] --> SYNC
        SYNC["Per-Repo Sync Workflow<br/><i>(see detail diagram)</i>"]
    end

    SUMMARY["Generate CI Summary Report"]

    VALIDATE --> EXPAND
    OPTS --> ForEach
    ForEach --> SUMMARY
```

### Sync Per-Repo Detail

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
        WRITE["Write config files<br/>(xfg template interpolation)"]
        WRITE --> ORPHANS["Detect & delete<br/>orphaned files"]
        ORPHANS --> MANIFEST["Update manifest<br/>(.xfg.json)"]
    end

    MANIFEST --> STAGE["git add -A"]
    STAGE --> STAGED{Staged changes?}
    STAGED -->|No| SKIP_NC["Skip — no changes"]
    STAGED -->|Yes| COMMIT_SELECT{Auth type?}
    COMMIT_SELECT -->|"GitHub App"| GQL["GraphQL commit<br/>(verified badge)"]
    COMMIT_SELECT -->|"PAT / CLI"| GIT["Git commit & push"]

    GQL --> DIRECT_CHECK
    GIT --> DIRECT_CHECK

    DIRECT_CHECK{Direct mode?}
    DIRECT_CHECK -->|Yes| DONE["Push to default branch ✓"]
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

### Settings Overview

```mermaid
flowchart TB
    subgraph Loading["Config Loading"]
        YAML[/"YAML Config File"/] --> REFS["Resolve @file references"]
        REFS --> VALIDATE["Validate structure"]
        VALIDATE --> VALIDATE_CMD["Validate for settings<br/>(require actionable settings)"]
    end

    subgraph Normalization
        EXPAND["Expand git arrays"] --> MERGE_S["Merge base + per-repo<br/>settings & rulesets"]
    end

    subgraph Lifecycle["Lifecycle Pre-Check (all unique repos)"]
        EXIST{"Repo exists?"} -->|Yes| READY["Ready"]
        EXIST -->|"No + upstream"| FORK["Fork"] --> READY
        EXIST -->|"No + source"| MIGRATE["Migrate"] --> READY
        EXIST -->|No| CREATE["Create with settings"] --> READY
    end

    subgraph Phase1["Phase 1: Rulesets"]
        RS["For each repo with rulesets<br/><i>(see detail diagram)</i>"]
    end

    subgraph Phase2["Phase 2: Repo Settings"]
        REPO["For each repo with repo settings<br/><i>(see detail diagram)</i>"]
    end

    REPORT["Generate Summary Report"]

    VALIDATE_CMD --> EXPAND
    MERGE_S --> Lifecycle
    Lifecycle --> Phase1
    Phase1 --> Phase2
    Phase2 --> REPORT
```

### Ruleset Processing Detail (per repo)

```mermaid
flowchart TB
    GUARD{GitHub repo?} -->|No| SKIP_P["Skip (GitHub only)"]
    GUARD -->|Yes| TOKEN["Resolve auth token"]

    TOKEN --> LIST["List current rulesets<br/>(summary only)"]
    LIST --> HYDRATE["Hydrate matching rulesets<br/>(full detail per match)"]

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

    APPLY --> MANIFEST_CHECK{deleteOrphaned?}
    MANIFEST_CHECK -->|No| DONE["Done ✓"]
    MANIFEST_CHECK -->|Yes| MANIFEST["Update manifest via<br/>git clone + commit + PR<br/>(branch: chore/sync-rulesets)"]
    MANIFEST --> DONE
```

### Repo Settings Processing Detail (per repo)

```mermaid
flowchart TB
    GUARD{GitHub repo?} -->|No| SKIP_P["Skip (GitHub only)"]
    GUARD -->|Yes| TOKEN["Resolve auth token"]

    TOKEN --> FETCH

    subgraph FETCH["Fetch Current State (4 API calls)"]
        direction TB
        F1["GET /repos — main settings"]
        F2["GET vulnerability-alerts"]
        F3["GET automated-security-fixes"]
        F4["GET private-vulnerability-reporting"]
    end

    FETCH --> SEC_VAL{"Security settings<br/>valid for repo<br/>visibility/owner?"}
    SEC_VAL -->|No| SEC_ERR["Error — abort repo"]
    SEC_VAL -->|Yes| DIFF["Diff: add / change"]

    DIFF --> CHANGES{Changes needed?}
    CHANGES -->|No| SKIP_NC["Skip — already matches ✓"]
    CHANGES -->|Yes| PLAN["Format terraform-style plan<br/>(warn on high-impact changes)"]
    PLAN --> DRY{Dry run?}
    DRY -->|Yes| SHOW["Show plan ✓"]
    DRY -->|No| APPLY

    subgraph APPLY["Apply (4 API calls, ordered)"]
        direction TB
        A1["PATCH /repos — main settings"]
        A2["PUT/DELETE vulnerability-alerts"]
        A3["PUT/DELETE private-vuln-reporting"]
        A4["PUT/DELETE automated-security-fixes<br/>(last — depends on vuln-alerts)"]
    end

    APPLY --> DONE["Done ✓"]
```
