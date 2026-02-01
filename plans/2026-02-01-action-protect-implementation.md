# GitHub Action Protect Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `command` input to action.yml to support both `sync` and `protect` commands.

**Architecture:** Add a new `command` input (default: `sync`). Modify the "Run xfg" step to insert the command after `xfg`. Sync-only flags (branch, merge, etc.) are only added when command is `sync`.

**Tech Stack:** GitHub Actions composite action (YAML + bash)

---

### Task 1: Update action.yml metadata and add command input

**Files:**

- Modify: `action.yml:1-2` (metadata)
- Modify: `action.yml:9` (add new input after line 8)

**Step 1: Update the action metadata**

Change lines 1-2 from:

```yaml
name: "xfg - Config File Sync"
description: "Sync JSON, JSON5, YAML, or text configuration files across multiple Git repositories via pull requests or direct push"
```

To:

```yaml
name: "xfg - Repo as Code"
description: "Sync files and manage repositories as code"
```

**Step 2: Add command input after line 8 (before config)**

Insert after `inputs:` (line 9):

```yaml
command:
  description: "Command to run (sync or protect)"
  required: false
  default: "sync"
```

**Step 3: Verify syntax**

Run: `cat action.yml | head -20`
Expected: See updated name, description, and new command input

**Step 4: Commit**

```bash
git add action.yml
git commit -m "feat(action): add command input for sync/protect"
```

---

### Task 2: Modify Run xfg step to use command input

**Files:**

- Modify: `action.yml:130-160` (Run xfg step)

**Step 1: Update the command building logic**

Change the "Run xfg" step's run script. Replace lines 131-156:

```bash
        # Build command with required arguments
        CMD="xfg ${{ inputs.command }}"
        CMD="$CMD --config ${{ inputs.config }}"
        CMD="$CMD --work-dir ${{ inputs.work-dir }}"
        CMD="$CMD --retries ${{ inputs.retries }}"

        # Add optional flags (shared)
        if [ "${{ inputs.dry-run }}" = "true" ]; then
          CMD="$CMD --dry-run"
        fi

        # Add sync-only flags
        if [ "${{ inputs.command }}" = "sync" ]; then
          if [ -n "${{ inputs.branch }}" ]; then
            CMD="$CMD --branch ${{ inputs.branch }}"
          fi

          if [ -n "${{ inputs.merge }}" ]; then
            CMD="$CMD --merge ${{ inputs.merge }}"
          fi

          if [ -n "${{ inputs.merge-strategy }}" ]; then
            CMD="$CMD --merge-strategy ${{ inputs.merge-strategy }}"
          fi

          if [ "${{ inputs.delete-branch }}" = "true" ]; then
            CMD="$CMD --delete-branch"
          fi
        fi
```

**Step 2: Verify the step looks correct**

Run: `grep -A 40 "Run xfg" action.yml`
Expected: See `xfg ${{ inputs.command }}` and sync-only conditional

**Step 3: Lint the action**

Run: `./lint.sh 2>&1 | grep -E "(ACTION|action)" | head -5`
Expected: `✅ ACTION | actionlint`

**Step 4: Commit**

```bash
git add action.yml
git commit -m "feat(action): use command input in Run xfg step"
```

---

### Task 3: Add integration test for protect via action

**Files:**

- Modify: `.github/workflows/ci.yaml` (add protect action test to integration-test-action job)

**Step 1: Find the integration-test-action job**

The job is around line 210-380. Add a protect test after the PAT sync tests.

**Step 2: Add protect action test steps**

After the `[PAT] Validate` step (around line 290), add:

```yaml
# ========== Protect Test ==========
- name: "[Protect] Run xfg action with protect command"
  uses: ./
  with:
    command: protect
    config: ./fixtures/integration-test-config-github-protect.yaml
    github-token: ${{ secrets.GH_PAT }}
    xfg-package: "./${{ env.XFG_PACKAGE }}"

- name: "[Protect] Validate - verify ruleset was created"
  env:
    GH_TOKEN: ${{ secrets.GH_PAT }}
  run: |
    RULESET=$(gh api repos/${TEST_REPO}/rulesets --jq '.[] | select(.name == "xfg-test-ruleset")')
    if [ -z "$RULESET" ]; then
      echo "ERROR: Ruleset was not created"
      exit 1
    fi
    echo "Ruleset created successfully"

- name: "[Protect] Cleanup - delete test ruleset"
  if: always()
  env:
    GH_TOKEN: ${{ secrets.GH_PAT }}
  run: |
    RULESET_ID=$(gh api repos/${TEST_REPO}/rulesets --jq '.[] | select(.name == "xfg-test-ruleset") | .id')
    if [ -n "$RULESET_ID" ]; then
      gh api --method DELETE repos/${TEST_REPO}/rulesets/${RULESET_ID}
      echo "Cleaned up test ruleset"
    fi
```

**Step 3: Lint the workflow**

Run: `./lint.sh 2>&1 | grep -E "ACTION" | head -3`
Expected: `✅ ACTION | actionlint`

**Step 4: Commit**

```bash
git add .github/workflows/ci.yaml
git commit -m "test(action): add protect command integration test"
```

---

### Task 4: Run full test suite and lint

**Files:** None (verification only)

**Step 1: Run unit tests**

Run: `npm test 2>&1 | tail -5`
Expected: `pass 1309` (or similar), `fail 0`

**Step 2: Run lint**

Run: `./lint.sh 2>&1 | tail -15`
Expected: `✅ Successfully linted all files without errors`

**Step 3: Verify git status**

Run: `git status`
Expected: Clean working tree (all changes committed)

---

### Task 5: Final commit with all changes

If any uncommitted changes remain, commit them:

```bash
git add -A
git commit -m "feat(action): complete protect command support"
```
