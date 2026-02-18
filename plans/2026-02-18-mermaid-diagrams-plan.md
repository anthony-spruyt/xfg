# Mermaid Diagram Rewrite Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the two stale mermaid diagrams in `docs/index.md` with accurate overview + detail diagrams for both sync and settings workflows.

**Architecture:** Single file edit — replace lines 216-314 of `docs/index.md` with new "How It Works" section containing 6 mermaid diagrams (2 sync + 1 settings overview + 2 settings details + section headers).

**Tech Stack:** Mermaid flowcharts, Markdown

---

### Task 1: Replace Sync Workflow Diagrams

**Files:**

- Modify: `docs/index.md:216-277` (the "How It Works" heading + sync mermaid block)

**Step 1: Replace the sync section**

Replace lines 216-277 (from `## How It Works` through the sync mermaid closing ` ``` `) with:

````markdown
## How It Works

### Sync Workflow (`xfg sync`)

#### Overview

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
        SYNC["Per-Repo Sync Workflow<br/><i>(see detail below)</i>"]
    end

    SUMMARY["Generate CI Summary Report"]

    VALIDATE --> EXPAND
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
````

**Step 2: Verify the edit preserved surrounding content**

Read `docs/index.md` around line 215 to confirm the `## How It Works` heading is intact and the new diagrams are present. Read the lines after the sync diagrams to confirm the settings section heading follows.

**Step 3: Commit**

```bash
git add docs/index.md
git commit -m "docs: replace stale sync workflow mermaid diagrams"
```

---

### Task 2: Replace Settings Workflow Diagrams

**Files:**

- Modify: `docs/index.md` (the settings mermaid block — formerly lines 279-314, now shifted by the Task 1 edit)

**Step 1: Replace the settings section**

Find and replace the old settings section (from `### Settings Workflow` through the closing ` ``` ` and the "See Use Cases" line) with:

````markdown
### Settings Workflow (`xfg settings`)

#### Overview

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
        RS["For each repo with rulesets<br/><i>(see detail below)</i>"]
    end

    subgraph Phase2["Phase 2: Repo Settings"]
        REPO["For each repo with repo settings<br/><i>(see detail below)</i>"]
    end

    REPORT["Generate Summary Report"]

    VALIDATE_CMD --> EXPAND
    MERGE_S --> Lifecycle
    Lifecycle --> Phase1
    Phase1 --> Phase2
    Phase2 --> REPORT
```

#### Ruleset Processing (per repo)

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

#### Repo Settings Processing (per repo)

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

**See [Use Cases](use-cases.md)** for real-world scenarios: platform engineering, CI/CD standardization, security governance, repo migration, and more.
````

**Step 2: Verify the edit preserved surrounding content**

Read the end of `docs/index.md` to confirm the "See Use Cases" link is the last line and no content was lost.

**Step 3: Commit**

```bash
git add docs/index.md
git commit -m "docs: replace stale settings workflow mermaid diagrams"
```

---

### Task 3: Validate Mermaid Syntax

**Step 1: Check all mermaid blocks parse correctly**

Run a quick syntax check on each mermaid block. Use `npx @mermaid-js/mermaid-cli` or equivalent to validate the 6 diagrams render without errors.

```bash
npx -y @mermaid-js/mermaid-cli mmdc -i docs/index.md -o /tmp/mermaid-test.md
```

If `mmdc` reports errors, fix the mermaid syntax in the failing block.

**Step 2: Commit any fixes**

```bash
git add docs/index.md
git commit -m "fix(docs): correct mermaid syntax errors"
```

---

### Task 4: Final Review

**Step 1: Read the complete "How It Works" section**

Read the full section from `## How It Works` to the end of the file to verify:

- All 6 diagrams are present (2 sync + 1 settings overview + 2 settings detail + section headers)
- Section headings use correct hierarchy (##, ###, ####)
- No orphaned content from the old diagrams remains
- The "See Use Cases" link is intact at the end

**Step 2: Run lint**

```bash
./lint.sh
```

Fix any lint errors in `docs/index.md`.

**Step 3: Final commit if needed**

```bash
git add docs/index.md
git commit -m "docs: fix lint issues in mermaid diagrams"
```
