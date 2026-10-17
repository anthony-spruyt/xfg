# xfg docs drift audit (2026-10-17)

Five read-only audits checked `docs/`, `CLAUDE.md`, `DEVELOPMENT.md`, `README.md` and `.claude/rules/integration-tests.md` against `packages/xfg/src`, `config-schema.json` and `action.yml`. Duplicates across audits are merged. Code paths are under `packages/xfg/src/` unless shown otherwise. "(guess)" means inferred from code, not run.

Totals after dedup: 27 WRONG, 46 STALE, 20 MISSING. The strict MkDocs build is clean (no broken links or anchors), `docs:check` and `test:typecheck` pass, and README pins and links are accurate.

Classes: **WRONG** misleads or breaks a user or contributor. **STALE** is out of date, low harm. **MISSING** is a real feature or rule no page explains.

## Decision: code bug or doc drift?

These four are places where the docs describe what xfg probably should do and the code does something else.

| ID | Docs say | Code does |
| --- | --- | --- |
| C5 | `groups.md:60`: each layer deep-merges file `vars` | A group-level file `vars` replaces root `vars` wholesale (`config/normalizer.ts:669-673`); only the repo level merges (`:956-959`). Root `{a,b}` + group `{b}` gives `{b}`, then `${xfg:a}` throws |
| C4 | `merge-strategies.md:12,141,147`: `merge` auto-matches on `type` or `actor_id` | Candidates are `type`, `actor_id` (`config/merge.ts:13`), but xfg's bypass actors use `actorId` (`config/types.ts:65-69`). `$arrayMerge: merge` on `bypassActors` duplicates instead of merging; users need `$matchBy: actorId` |
| C2 | `lifecycle.md:104,131,140-148`: per-repo `settings.repo` (e.g. `defaultBranch`) applies on create/fork/migrate | Lifecycle only gets root `config.settings.repo` (`cli/repo-sync-runner.ts:85`, `lifecycle/helpers.ts:73`). Per-repo/group `visibility`, `description`, `hasIssues`, `hasWiki`, `defaultBranch` are ignored on create; the later settings step can target a branch that doesn't exist |
| E4 | `platforms/github-app.md:64,94`, `ci-cd/github-actions.md:122`: skips repos without app access | Skips only when the owner has no installation (`shared/gh-token-utils.ts:56-58`). Tokens are per owner with no repo list (`vcs/github-app-token-manager.ts:180-186`), so a repo left out of a "selected repositories" install (which `github-app.md:34` suggests) fails instead |

## A. CLAUDE.md, DEVELOPMENT.md, integration-tests rule

| ID | Where | Says | True (evidence) | Class |
| --- | --- | --- | --- | --- |
| A1 | CLAUDE.md:50 | Node.js >= 20 | `>=22` (`packages/xfg/package.json:32`); test runner needs Node 22 `globSync` (`scripts/run-tests.js:6`); CI uses 24 | WRONG |
| A2 | CLAUDE.md:75 | lifecycle manager does creation, deletion, mirror push | Create, fork, migrate only (`lifecycle/repo-lifecycle-manager.ts:38-84`); no deletion; mirror push is in `lifecycle/github-lifecycle-provider.ts:573-622` | WRONG |
| A3 | CLAUDE.md:76 | auth via `-c url.insteadOf` | Token embedded in the clone URL (`x-access-token`), later commands reuse the remote (`vcs/authenticated-git-ops.ts:9-13,55,138`); tests assert insteadOf is not used | WRONG |
| A4 | CLAUDE.md:104 | branch `chore/sync-config`, reuses existing branch/PR | Single unique file gives `chore/sync-<file>` (`cli/sync-utils.ts:15-19`); an existing PR is closed and its branch deleted (`sync/branch-manager.ts:39-55`) | WRONG |
| A5 | DEVELOPMENT.md:10,95,114-115,125,308,392,430 | secrets in `~/.secrets/.env` | Devcontainer loads `~/.secrets/.env.common` and `~/.secrets/.env.xfg`, mounts `~/.secrets/.gitignore` (`.devcontainer/devcontainer.json:19-25`) | WRONG |
| A6 | .claude/rules/integration-tests.md:20-28 | sample `before`/`after` call `createRepo`/`deleteRepo` without `await` | Both async (`test/integration/test-helpers.ts:566,585`); real tests await | WRONG |
| A7 | CLAUDE.md:70 | validator "via `validateForSync`" | Structural entry is `validateRawConfig` from the loader (`config/loader.ts:70,186`); `validateForSync` is sync's check; module also holds secrets and normalized validators | STALE |
| A8 | CLAUDE.md:98 | `docs/superpowers/` triggers docs deploy | Pushes there no longer trigger it (`.github/workflows/docs.yaml:10`); PRs build it, next deploy publishes it. Keep the rule, fix the reason | STALE |
| A9 | CLAUDE.md:44 | release PR: "a human merges it" | Merges via Mergify once a collaborator approves (`.mergify.yml:72`, DEVELOPMENT.md:451, repo-operator's PR approval gate) | STALE |
| A10 | DEVELOPMENT.md:509 | `npm run dev` via ts-node | tsx (`packages/xfg/package.json:37`) | STALE |
| A11 | DEVELOPMENT.md:471 | pin `xfg@v6` | Current major is 8 | STALE |
| A12 | DEVELOPMENT.md:289 | `post-create.sh` script | No such file; image's `devcontainer-post-create` calls `.devcontainer/setup-devcontainer.sh` | STALE |
| A13 | DEVELOPMENT.md:293 | Docker-in-Docker | Rootful Podman with a `docker` wrapper (`.devcontainer/README.md`) | STALE |
| A14 | DEVELOPMENT.md:106,118 | devcontainer mounts `~/.gitconfig` | Not in mounts (`devcontainer.json:24-29`); (guess) VS Code copies it in | STALE |
| A15 | integration-tests.md:58 | ci.yaml runs lint, repo, summary | Also `image` and `sonar` (`.github/workflows/ci.yaml:37-59`) | STALE |
| A16 | DEVELOPMENT.md:442 | "`docs/` links here" (Releases) | No docs page links to #releases | STALE |
| A17 | CLAUDE.md:27-38 | checklist says `npm test` | CI runs `test:coverage` with a 95% line gate (`package.json:41`, `ci-repo.yaml:140`) | MISSING |
| A18 | CLAUDE.md:35-38 | three integration scripts | 11 more exist (rulesets, labels, repo-settings, secrets, variables, lifecycle, ai, app; `package.json:46-56`) | MISSING |
| A19 | CLAUDE.md:63-79 | Key Modules table | Missing `cli/sync-command.ts` (composition root), `cli/secrets-command.ts`, `src/ai/` | MISSING |

## B. Top-level user docs

| ID | Where | Says | True (evidence) | Class |
| --- | --- | --- | --- | --- |
| B1 | getting-started/index.md:13-15 | `cd xfg && npm install && npm run build` | No root `package.json`; package is `packages/xfg` | WRONG |
| B2 | getting-started/prerequisites.md:13-16; index.md:187 | GHES needs only `gh auth login --hostname` / `githubHosts` | Since v8, a non-github.com host throws `GitHubHostNotAllowedError` unless in `XFG_ALLOWED_GITHUB_HOSTS` (`shared/github-host-policy.ts:24-29`, CHANGELOG.md:112-114) | WRONG |
| B3 | use-cases.md:174-184 | per-repo `rules:` override only bumps the review count | Rulesets merge with `replace` (`config/normalizer.ts:200`); the repo ends up with only that one rule (ran) | WRONG |
| B4 | index.md:154 | migrate from "Azure DevOps or GitLab" | Only `azure-devops` (`lifecycle/repo-lifecycle-factory.ts:70-78`) | WRONG |
| B5 | ide-integration.md:9-18; every use-cases.md config; platforms/github.md:45-58,80-94 | full example configs with no `id` | Fails: "Config requires an 'id' field" (`config/validator.ts:55-57`) (ran) | WRONG |
| B6 | migration-v4.md:57 | manifest `.xfg-manifest.json` | `.xfg.json` (`sync/manifest.ts:8`), also at v4.0.0 | WRONG |
| B7 | migration-v4.md:33 | "Before (v3)" block uses `@v4` | `@v3` | STALE |
| B8 | reference/cli-options.md:59-74 | sample output ("Found 3 repositories with rulesets", "Completed: …") | Strings don't exist: "Found N repositories to process" (`cli/sync-command.ts:146`), `[i/N] repo: Processing...`, `<repo> - Rulesets:` plan header or `✓ repo: Rulesets: Applied: 1 created`; zero counts omitted; ends with "Plan: …" or "No changes" (`output/sync-report.ts:34-41`) | STALE |
| B9 | usage/index.md:90-118 | sample output ("Cloned repository", "Pushed to remote", "Summary: …") | Real: "Writing X...", "Staging changes...", "Committed: sha (verified: …)", "Creating pull request..."; skip prints `⊘ repo: Skipped - No changes detected` | STALE |
| B10 | use-cases.md:229-247 | repo settings sample output | `<repo> - Repo Settings:` header; "Repo Settings: No changes needed" | STALE |
| B11 | usage/index.md:38,54 | content diffs only for .json/.json5/.yaml/.yml | Every non-binary file (`sync/file-writer.ts:160-164`) | STALE |
| B12 | usage/index.md:124-125 | title `chore: sync config files`, branch `chore/sync-config` | 4+ files: "chore: sync N config files" (`vcs/pr-creator.ts:172`); one file: `chore/sync-<file>` | STALE |
| B13 | index.md:226,332-363,371,438 | requires files; lifecycle pre-check across all repos; phase order; rulesets/labels read the manifest | Settings-only configs valid; flow is per repo lifecycle → files → settings (`cli/repo-sync-runner.ts:247-262`); order rulesets, labels, repo, codeScanning, variables, collaborators, environments (`cli/settings-runner.ts:86-198`); nothing in settings reads the manifest | STALE |
| B14 | index.md:195,200 | step summary repo heading `@@ repo @@` | `### repo` (`cli/unified-summary.ts:184`) | STALE |
| B15 | ide-integration.md:40-45 | field lists, mergeStrategy enum, "required fields (id, repos)" | Lists miss groups, conditionalGroups, upstream, source, most settings keys; enum has `merge`; schema root has no `required` | STALE |
| B16 | usage/index.md:3; reference/cli-options.md:3,7,34 | what `sync` manages | Leaves out codeScanning, collaborators, environments; usage also omits `secrets sync` | STALE |
| B17 | use-cases.md:38 | "Run `xfg`" | Bare `xfg` prints help and exits 1; use `xfg sync` | STALE |
| B18 | prerequisites.md:21; troubleshooting.md:42; platforms/github.md:20,98; ci-cd/github-actions.md:130,175 | classic PAT needs `repo` | Also `workflow` to push `.github/workflows/` (GitHub rule; secret-rotation.md:15 already says so) | STALE |
| B19 | mkdocs.yml nav | migration pages v3→4, v4→5, v6→7 | No v7→8 page (v8 added `XFG_ALLOWED_GITHUB_HOSTS`, CHANGELOG.md:112-114); no v5→6 page (v6 renamed `github-app-id`→`github-client-id`, `XFG_GITHUB_APP_ID`→`XFG_GITHUB_CLIENT_ID`) | MISSING |
| B20 | getting-started/index.md | no Node requirement | `engines.node >=22` | MISSING |
| B21 | troubleshooting.md | — | No `XFG_DEBUG`/`DEBUG` (`cli/sync-command.ts:106`), no GHES host-policy error | MISSING |
| B22 | security/secret-rotation.md:9-15 | credential table | Omits AI keys `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (`shared/credential-env.ts:14-15`) | MISSING |
| B23 | getting-started/prerequisites.md | three `!!! note` blocks | Bodies unindented: boxes render empty, text falls outside | MISSING |

## C. File-sync config pages

C2, C4, C5 are in the decision table above.

| ID | Where | Says | True (evidence) | Class |
| --- | --- | --- | --- | --- |
| C1 | configuration/groups.md:284-293 | group ruleset `rules:` as a map, snake_case keys | Array of `{type, parameters}`, camelCase; example fails validation (`config/validators/ruleset-validator.ts:348-353`) (ran) | WRONG |
| C3 | configuration/index.md:35 | root `deleteOrphaned`: files/rulesets removed are deleted | Root flag is files only (`config/normalizer.ts:960-963`); rulesets read `settings.deleteOrphaned` | WRONG |
| C6 | content-types.md:93; configuration/index.md:53; examples/yaml-comments.md:94-95 | `header`/`schemaUrl` only for YAML | `header` also written for `.json5` as `//` lines (`config/formatter.ts:68-71,152-156`) (ran) | MISSING |
| C7 | content-types.md:28 | `.json5` output supports comments, trailing commas | Output is plain `JSON.stringify` (`config/formatter.ts:159`) | STALE |
| C8 | content-types.md:53-57,75-78; examples/yaml-comments.md:24-30,49-53,73-77 | rendered YAML unquoted, no blank line after header | Strings double-quoted, blank line after header (`config/formatter.ts:144-149`) (ran) | STALE |
| C9 | configuration/index.md:50 | mergeStrategy `replace`, `append`, `prepend` | Also `merge` (`config/validators/file-validator.ts:16-21`) | STALE |
| C10 | configuration/index.md:41; reference/config-schema.md:69 | at least one of files/settings/groups/conditionalGroups; a separate `settings` command | No `settings` command (removed in v4); `sync` takes settings-only configs; per-repo settings alone pass; groups with only `prOptions` fail (`config/validator.ts:268-363`) (ran) | WRONG |
| C11 | pr-options.md:100 | branch auto-named from file names | Only when the config has exactly one unique file; else `chore/sync-config` | STALE |
| C12 | pr-options.md:12; examples/auto-merge.md:101; platforms/azure-devops.md:33 | `bypassReason` required for `force` | Optional, default "Automated config sync via xfg" (`vcs/ado-pr-strategy.ts:400-401`) | STALE |
| C13 | pr-templates.md:211-225 | default template has `## Source` | `packages/xfg/PR.md:3-15` has a `---` rule and "automatically generated" footer, no Source | STALE |
| C14 | multi-file.md:190-191 | error strings | `No 'id' found in any config file — exactly one file must define 'id'` (`config/config-merger.ts:83`); `No .yaml or .yml files found in directory: <dir>` (`config/loader.ts:140`) | STALE |
| C15 | multi-file.md:126 | other keys must appear in exactly one file | Single-file keys appear in zero or one file; keys outside the list are silently dropped (`config/config-merger.ts:43-100`) | STALE |
| C16 | lifecycle.md:164-165 | dry run prints `+ FORK github.com/opensource/tool -> …` | Prints the URL as configured, e.g. `git@github.com:opensource/tool.git` (`lifecycle/formatter.ts:36,44`) | STALE |
| C17 | groups.md:435 | conditions checked against frozen set of explicit groups | Set includes transitive `extends` parents (`config/normalizer.ts:1040-1057`; groups.md:178 agrees) | STALE |
| C18 | templating.md | — | Custom `vars` override built-ins (`shared/xfg-template.ts:272-280`) | MISSING |
| C19 | merge-strategies.md:227-256 | — | `mergeStrategy: merge` on text-line arrays behaves like `append` (`config/merge.ts:539-541`) | MISSING |

## D. GitHub settings pages

| ID | Where | Says | True (evidence) | Class |
| --- | --- | --- | --- | --- |
| D1 | rulesets.md:442 | xfg tracks which rulesets it manages | Deletes every ruleset not in config, hand-made ones too; nothing tracked (`settings/rulesets/diff.ts:263-275`; manifest tracks files only) | WRONG |
| D2 | rulesets.md:444-447,502 | example puts `deleteOrphaned: true` at top level | Rulesets read `settings.deleteOrphaned` (`settings/rulesets/processor.ts:66`); example never deletes | WRONG |
| D3 | variables.md:96 | deletes variables previously managed by xfg | Deletes every repo variable not in config (`settings/variables/diff.ts:173-178`) | WRONG |
| D4 | secrets.md:187; environments.md:205; platforms/github-app.md:66 | "Secrets: Read and write" covers environment secrets | Environment secret endpoints need **Environments: Read and write**; listing environments needs **Actions: Read** (GitHub permission data) | WRONG |
| D6 | code-scanning.md:79 | no GHAS: report an error and skip that repo | Only the code-scanning step fails; other settings still apply; run exits non-zero (`settings/code-scanning/processor.ts:82-87`, `cli/sync-command.ts:200-202`); only checked for `state: configured` | WRONG |
| D7 | repo-settings.md:159-164,176-188 | sample output, `Warning:` prefix | `<repo> - Repo Settings:` header (`cli/settings-runner.ts:45`); warnings print `⚠ <msg>` (`shared/logger.ts:84`) | STALE |
| D8 | rulesets.md:472-483 | "Found 2 repositories with rulesets", "1 created, 0 updated, 0 deleted" | "Found N repositories to process"; zero counts omitted (`settings/base-processor.ts:150-157`); `<repo> - Rulesets:` plan lines | STALE |
| D9 | variables.md:113-121 | `+ NODE_VERSION = "20"`, `(dry-run)` | `Create:` / `+ variable "X"` / `value: "…"` / `Plan: N variables (…)` (`settings/variables/formatter.ts:45-101`) | STALE |
| D10 | environments.md:196-200 | secret lines: delete, create, update | Create, update, delete (`settings/secrets/formatter.ts:23-27,63`) | STALE |
| D11 | rulesets.md:386 | strategies append, prepend, replace | Also `merge` and `$matchBy` (`config-schema.json` `arrayMergeDirective`) | STALE |
| D12 | rulesets.md:36-42 | two commands "Sync files" and "Apply rulesets" | Both are the same `xfg sync` | STALE |
| D13 | labels.md:80 | xfg rejects a config with chained renames | Caught per repo at diff time: labels step fails with "Rename chain: …" (`settings/labels/diff.ts:77`) | STALE |
| D14 | reference/config-schema.md:851,855 | the schema validates `id`/`repos`/path traversal | Schema root has no `required`; code checks them (`config/validator.ts:55,310`) | STALE |
| D15 | variables.md | — | `inherit: false` + inherited `deleteOrphaned` deletes inherited variables (`config/normalizer.ts:300-330,576`); config-schema.md:336 points here for it | MISSING |
| D16 | repo-settings.md:223-229 | — | Undocumented failures: `privateVulnerabilityReporting` public-only; `secretScanning`/push protection need GHAS on non-public or user-owned repos; `defaultBranch` must exist (`settings/repo-settings/processor.ts:150,243-268`) | MISSING |
| D17 | environments.md:204 | — | Listing environments and branch policies needs **Actions: Read** (enforcement is a guess) | MISSING |
| D18 | environments.md:41 | — | #1234: a workflow pushed in the same `xfg sync` run as its environment can start before `xfg secrets sync` writes the secrets, fail once, and pass on re-run. Append one sentence after "Run `xfg sync` first…"; optional cross-reference at secrets.md:244 | MISSING |

## E. Examples, platforms, CI

E4 is in the decision table above.

| ID | Where | Says | True (evidence) | Class |
| --- | --- | --- | --- | --- |
| E1 | examples/create-only.md:15-20 | `.prettierignore` with object `content: {patterns: [...]}` | Fails: "has text extension but object content" (`config/validators/shared.ts:67`) (ran) | WRONG |
| E3 | platforms/github.md:172 | rulesets need PAT scope `admin:repo` | No such classic scope; `repo` plus repo admin rights | WRONG |
| E5 | ci-cd/azure-pipelines.md:18,67 | `versionSpec: "20.x"` | `engines.node >=22` | WRONG |
| E6 | ci-cd/github-actions.md:146-169,183-206; ci-cd/azure-pipelines.md:5-25 | manual install-and-run workflows | No git `user.name`/`user.email` step; xfg never sets one; the action does (`action.yml:102-108`). (guess) PAT-mode commits fail | WRONG |
| E7 | platforms/github-app.md:74 | tokens cached 55 minutes | 45 minutes (`vcs/github-app-token-manager.ts:11-12`) | STALE |
| E8 | platforms/github-app.md:101,134 | limit is files over 50MB | 50MB applies to the whole commit after base64, about 37MB raw (`vcs/graphql-commit-strategy.ts:153-163`) | STALE |
| E9 | examples/delete-orphaned.md:84-92 | manifest `version: 2`, `configs.<id>: [files]` | `version: 4`, `configs.<id>.files: [...]` (`sync/manifest.ts:48-52,134-138`) | STALE |
| E12 | ci-cd/index.md:23 | GitHub token is `GH_TOKEN` or `GITHUB_TOKEN` | `sync` uses only `GH_TOKEN` (`cli/sync-command.ts:157`); only `secrets sync` falls back to `GITHUB_TOKEN` | STALE |
| E13 | several | small items | Snippets with `prOptions: merge: direct` and no `id`/`files` (github.md:130, azure-devops.md:54, gitlab.md:64); `az devops configure --defaults` unneeded (azure-devops.md:14; xfg passes `--org`/`--project`); `@templates/prettier.json` typo (examples/file-references.md:27); `actions/setup-node@v4` vs action's v7 (`action.yml:80`) | STALE |
| E14 | platforms/azure-devops.md, gitlab.md, index.md | — | Not stated: settings, secrets, lifecycle are GitHub-only and skipped elsewhere (`settings/base-processor.ts:82-87`, `lifecycle/repo-lifecycle-manager.ts:54`); ADO is only a migration source; ADO ignores `mergeStrategy: rebase` (`vcs/ado-pr-strategy.ts:379,417`) | MISSING |
| E15 | platforms/index.md:3 | auto-detected from the git URL | Unknown hosts are treated as self-hosted GitLab (`repo/detector.ts:102-105`); a GHE host missing from `githubHosts` silently becomes GitLab | MISSING |
| E16 | ci-cd/github-actions.md:46-60 | multi-platform example | Action sets git credentials only for `https://dev.azure.com` and `https://gitlab.com` (`action.yml:113-123`); self-hosted GitLab and SSH URLs get none; ADO pipeline docs have no credential step (guess) | MISSING |
| E17 | platforms/github-app.md:19-25 | App permission list | No "Variables: Read and write", needed by `settings.variables` (`settings/variables/github-variables-strategy.ts:32`) | MISSING |
| E18 | platforms/github.md:74; github.md GHE section | IP rule covers `githubHosts`; no `allowed-github-hosts` input | `githubHosts` doesn't reject IPs (`config/validator.ts:159-179`; the host policy still blocks); action input `allowed-github-hosts` not mentioned. (guess) self-hosted GitLab may need `GITLAB_HOST` for `glab` (`vcs/gitlab-pr-strategy.ts:26`) | MISSING |

## Not docs (left out of the docs PR)

- CLAUDE.md rule breaks in code: `sync/auth-options-builder.ts:14` takes concrete `GitHubAppTokenManager` (an `ITokenManager` exists); it and `sync/repository-session.ts:14` take full `ILogger` where narrower log types exist.
- Stale code comments: `sync/manifest.ts:13-15` (drop V1/V2 "at v7"), `sync/sync-workflow.ts:24` (mentions a manifest strategy that no longer exists).
- `.claude/agents/*` name `workspace.sh`, `ci-status.sh`, `push-reviewed.sh`, which aren't in this container: environment, synced from repo-operator.
- 4 unit tests fail only when run as root (`config/loader.test.ts:625`): environment.
