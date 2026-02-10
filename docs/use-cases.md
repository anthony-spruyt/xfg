# Use Cases

xfg solves the challenge of keeping configuration files consistent across many Git repositories. Here are common scenarios where it helps.

## Platform Engineering Teams

**Problem:** You have dozens or hundreds of microservices, each in its own repository. Keeping tooling configs consistent is a nightmare of manual PRs or copy-paste drift.

**Solution:** Define your organization's standard configs once and sync them everywhere:

```yaml
files:
  .prettierrc.json:
    content:
      semi: false
      singleQuote: true
      printWidth: 100

  tsconfig.json:
    content:
      compilerOptions:
        target: ES2022
        module: NodeNext
        strict: true

  .eslintrc.json:
    content:
      extends: ["@your-org/eslint-config"]

repos:
  - git:
      - git@github.com:your-org/service-auth.git
      - git@github.com:your-org/service-payments.git
      - git@github.com:your-org/service-notifications.git
      # ... hundreds more
```

Run `xfg` whenever standards change—PRs are created automatically for review.

---

## CI/CD Workflow Standardization

**Problem:** Your GitHub Actions workflows have diverged across repos. Some have outdated Node versions, others are missing security scans, and updating them all manually would take days.

**Solution:** Sync workflow files to subdirectories:

```yaml
files:
  ".github/workflows/ci.yaml":
    content:
      name: CI
      on: [push, pull_request]
      jobs:
        build:
          runs-on: ubuntu-latest
          steps:
            - uses: actions/checkout@v4
            - uses: actions/setup-node@v4
              with:
                node-version: "24"
            - run: npm ci
            - run: npm test

  ".github/dependabot.yml":
    content:
      version: 2
      updates:
        - package-ecosystem: npm
          directory: "/"
          schedule:
            interval: weekly

repos:
  - git:
      - git@github.com:your-org/frontend.git
      - git@github.com:your-org/backend.git
      - git@github.com:your-org/shared-libs.git
```

---

## Security & Compliance Governance

**Problem:** Your security team needs to roll out CodeQL scanning and Dependabot configs to all repositories. Manual enforcement doesn't scale.

**Solution:** Define security configs centrally and push to all repos:

```yaml
files:
  ".github/dependabot.yml":
    content:
      version: 2
      updates:
        - package-ecosystem: npm
          directory: "/"
          schedule:
            interval: daily
          open-pull-requests-limit: 10

  ".github/workflows/codeql.yml":
    content: "@templates/codeql-workflow.yml"

  ".github/SECURITY.md":
    content: "@templates/SECURITY.md"

repos:
  - git:
      - git@github.com:your-org/public-api.git
      - git@github.com:your-org/customer-portal.git
    prOptions:
      merge: auto # Auto-merge when checks pass
```

Use [file references](configuration/file-references.md) to load complex templates from external files.

---

## Branch Protection at Scale

**Problem:** You need consistent branch protection rules across all repositories. Managing rulesets manually through the GitHub UI doesn't scale, and there's no audit trail for changes.

**Solution:** Define GitHub Rulesets declaratively and apply them with `xfg settings`:

```yaml
settings:
  rulesets:
    main-protection:
      target: branch
      enforcement: active
      bypassActors:
        - actorId: 2719952
          actorType: Integration # e.g., Renovate bot
          bypassMode: always
      conditions:
        refName:
          include:
            - refs/heads/main
      rules:
        - type: pull_request
          parameters:
            requiredApprovingReviewCount: 1
            dismissStaleReviewsOnPush: true
            requireCodeOwnerReview: true
        - type: required_status_checks
          parameters:
            strictRequiredStatusChecksPolicy: true
            requiredStatusChecks:
              - context: "ci/build"
              - context: "ci/test"

    release-protection:
      target: branch
      enforcement: active
      conditions:
        refName:
          include:
            - refs/heads/release/*
      rules:
        - type: pull_request
          parameters:
            requiredApprovingReviewCount: 2
        - type: required_signatures

repos:
  - git:
      - git@github.com:your-org/service-auth.git
      - git@github.com:your-org/service-payments.git
      - git@github.com:your-org/service-critical.git
```

Run `xfg settings --config ./config.yaml` to apply rules to all repos. Stricter requirements for specific repos? Override per-repo:

```yaml
repos:
  - git: git@github.com:your-org/service-critical.git
    settings:
      rulesets:
        main-protection:
          rules:
            - type: pull_request
              parameters:
                requiredApprovingReviewCount: 3 # Override default
```

---

## Repository Settings at Scale

**Problem:** Your GitHub repositories have inconsistent merge strategies, security settings, and feature toggles. Some repos allow merge commits while others only allow squash. Dependabot alerts are enabled on some but not others. Managing this through the GitHub UI doesn't scale.

**Solution:** Define repository settings declaratively and apply them with `xfg settings`:

```yaml
settings:
  repo:
    # Standardize merge options
    allowSquashMerge: true
    allowMergeCommit: false
    allowRebaseMerge: false
    deleteBranchOnMerge: true
    allowAutoMerge: true

    # Enforce security settings
    vulnerabilityAlerts: true
    automatedSecurityFixes: true
    secretScanning: true
    secretScanningPushProtection: true

    # Disable unused features
    hasWiki: false
    hasProjects: false

repos:
  - git:
      - git@github.com:your-org/service-auth.git
      - git@github.com:your-org/service-payments.git
      - git@github.com:your-org/service-notifications.git
```

Preview changes with dry-run:

```bash
xfg settings -c config.yaml --dry-run
```

Output shows exactly what will change:

```text
Processing repo settings for 3 repositories

  your-org/service-auth:
  Repo Settings:
    + allowAutoMerge: true
    ~ allowMergeCommit: true → false
    ~ deleteBranchOnMerge: false → true
    + secretScanning: true

  your-org/service-payments:
  Repo Settings:
    (no changes)

  your-org/service-notifications:
  Repo Settings:
    + vulnerabilityAlerts: true
    + automatedSecurityFixes: true
```

Override settings for specific repos that need different configuration:

```yaml
repos:
  - git: git@github.com:your-org/legacy-monolith.git
    settings:
      repo:
        # This repo needs merge commits for its workflow
        allowMergeCommit: true
        # Keep wiki for legacy docs
        hasWiki: true
```

---

## Developer Experience Consistency

**Problem:** Every repository has slightly different formatter settings, editor configs, and tooling. Developers waste time adjusting to each repo's quirks.

**Solution:** Standardize the developer experience:

```yaml
files:
  .editorconfig:
    content:
      - "root = true"
      - ""
      - "[*]"
      - "indent_style = space"
      - "indent_size = 2"
      - "end_of_line = lf"
      - "charset = utf-8"
      - "trim_trailing_whitespace = true"
      - "insert_final_newline = true"

  .prettierrc.json:
    content:
      semi: false
      singleQuote: true
      tabWidth: 2
      trailingComma: es5

  .prettierignore:
    content:
      - "dist/"
      - "node_modules/"
      - "coverage/"

  .nvmrc:
    content: "20"

repos:
  - git:
      - git@github.com:your-org/repo-1.git
      - git@github.com:your-org/repo-2.git
```

New team members get the same experience in every repo from day one.

---

## Open Source Project Maintainers

**Problem:** You maintain multiple related open source projects. Keeping issue templates, contributing guidelines, and CI workflows consistent is tedious.

**Solution:** Manage your project ecosystem from one config:

```yaml
files:
  ".github/ISSUE_TEMPLATE/bug_report.md":
    content: "@templates/bug-report.md"

  ".github/ISSUE_TEMPLATE/feature_request.md":
    content: "@templates/feature-request.md"

  ".github/CONTRIBUTING.md":
    content: "@templates/CONTRIBUTING.md"

  ".github/workflows/ci.yaml":
    content: "@templates/oss-ci.yaml"

  LICENSE:
    content: "@templates/MIT-LICENSE"

repos:
  - git:
      - git@github.com:your-name/project-core.git
      - git@github.com:your-name/project-cli.git
      - git@github.com:your-name/project-plugins.git
```

---

## Configuration Drift Prevention

**Problem:** Configurations drift over time as individual repos make local changes. You need to detect and fix drift automatically.

**Solution:** Run xfg on a schedule in CI:

```yaml
# .github/workflows/sync-configs.yaml
name: Sync Configs
on:
  schedule:
    - cron: "0 9 * * 1" # Every Monday at 9am
  workflow_dispatch:

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
      - run: npm install -g @aspruyt/xfg
      - run: xfg sync --config ./config.yaml
        env:
          GH_TOKEN: ${{ secrets.SYNC_TOKEN }}
```

Drift is detected weekly, and PRs are created to bring repos back into compliance.

---

## Migrating to New Standards

**Problem:** You're adopting a new tool (like switching from ESLint to Biome, or adding Renovate) and need to roll it out across many repos.

**Solution:** Use `createOnly` for new files that shouldn't overwrite existing ones:

```yaml
files:
  renovate.json:
    createOnly: true # Only create if doesn't exist
    content:
      "$schema": "https://docs.renovatebot.com/renovate-schema.json"
      extends:
        - "config:recommended"
        - ":preserveSemverRanges"

  biome.json:
    content:
      "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json"
      organizeImports:
        enabled: true
      linter:
        enabled: true

repos:
  - git:
      - git@github.com:your-org/repo-1.git
      - git@github.com:your-org/repo-2.git
```

---

## Hybrid Teams (Multi-Platform)

**Problem:** Your organization uses GitHub for open source, Azure DevOps for enterprise apps, and GitLab for internal tools. You need consistency across all platforms.

**Solution:** xfg works with all three platforms in the same config:

```yaml
files:
  .prettierrc.json:
    content:
      semi: false
      singleQuote: true

repos:
  # GitHub repos
  - git: git@github.com:your-org/oss-project.git

  # Azure DevOps repos
  - git: git@ssh.dev.azure.com:v3/your-org/project/enterprise-app

  # GitLab repos (including self-hosted)
  - git: git@gitlab.example.com:your-org/internal-tool.git
```

---

## Why xfg vs. Alternatives

| Approach                | Drawback                             | xfg Advantage                           |
| ----------------------- | ------------------------------------ | --------------------------------------- |
| **Manual PRs**          | Doesn't scale past 10 repos          | Automates PR creation                   |
| **Monorepo**            | Major migration, not always feasible | Works with existing multi-repo setup    |
| **Git submodules**      | Complex, poor DX                     | Simple YAML config                      |
| **Copy-paste**          | Leads to drift                       | Enforces single source of truth         |
| **GitHub Actions sync** | GitHub-only                          | Works with GitHub, Azure DevOps, GitLab |
