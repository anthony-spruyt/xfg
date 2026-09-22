# Config Schema Reference

The full JSON Schema for xfg configuration files is available at:

```text
https://raw.githubusercontent.com/anthony-spruyt/xfg/main/config-schema.json
```

## Using the Schema

### In VS Code

Add a comment at the top of your config file:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/anthony-spruyt/xfg/main/config-schema.json
files:
  # ...
repos:
  # ...
```

Or configure in `.vscode/settings.json`:

```json
{
  "yaml.schemas": {
    "https://raw.githubusercontent.com/anthony-spruyt/xfg/main/config-schema.json": [
      "**/sync-config.yaml",
      "**/config-sync.yaml"
    ]
  }
}
```

## Schema Structure

### Root Object

<!-- xfg:generated schema:root -->

<!-- markdownlint-disable MD013 -->

| Field               | Type                                                  | Required | Default | Description                                                                                                                                                                                                                                                                                                           |
| ------------------- | ----------------------------------------------------- | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | `string`                                              | No       | -       | Unique identifier for this config. Used to namespace managed files in .xfg.json manifest, allowing multiple configs to manage the same repo without conflicts.                                                                                                                                                        |
| `files`             | `object` of [`fileConfig`](#fileconfig)               | No       | -       | Map of target filenames to their configurations. Each file is synced to all repos by default.                                                                                                                                                                                                                         |
| `groups`            | `object` of [`groupConfig`](#groupconfig)             | No       | -       | Named configuration groups that repos can reference via 'groups: [...]'. Groups create a merge chain: root → group1 → group2 → repo overrides. Each group can define files, prOptions, and settings.                                                                                                                  |
| `conditionalGroups` | [`conditionalGroupConfig`](#conditionalgroupconfig)[] | No       | -       | Conditional groups that activate based on which groups a repo has. Each entry has a 'when' clause (allOf/anyOf/noneOf) and the same files/prOptions/settings as regular groups. Merges after explicit groups, before repo overrides.                                                                                  |
| `repos`             | [`repo`](#repo)[]                                     | No       | -       | List of repository configurations. When using directory-based config, repos can be split across multiple files. Directory-based config recursively scans subdirectories.                                                                                                                                              |
| `prOptions`         | [`prOptions`](#proptions)                             | No       | -       | Global PR merge options. Can be overridden per-repo.                                                                                                                                                                                                                                                                  |
| `prTemplate`        | `string`                                              | No       | -       | Custom PR body template. Can be inline markdown or a file reference (@path/to/template.md relative to config file). Supports ${xfg:...} templating variables: ${xfg:pr.fileChanges} (bulleted file list), ${xfg:pr.fileCount}, ${xfg:pr.title}, plus all repo variables (repo.name, repo.owner, repo.fullName, etc.). |
| `githubHosts`       | `string[]`                                            | No       | -       | List of GitHub Enterprise Server hostnames. URLs matching these hosts will be treated as GitHub repositories instead of falling back to GitLab detection. Example: ['github.mycompany.com', 'ghe.internal.net']                                                                                                       |
| `deleteOrphaned`    | `boolean`                                             | No       | `false` | Global default for orphan deletion. When true, files removed from the xfg config will be deleted from target repos (tracked via .xfg.json manifest). Can be overridden per-file or per-repo. Default: false                                                                                                           |
| `settings`          | [`rootSettings`](#rootsettings)                       | No       | -       | Global repository settings including GitHub Rulesets. Can be overridden per-repo. Settings are merged: per-repo rulesets override root rulesets with same name.                                                                                                                                                       |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

!!! note "files/settings/groups requirement"
    At least one of `files`, `settings`, `groups`, or `conditionalGroups` must be present. The `sync` command requires files defined in root `files`, in a group, or in a conditional group. The `settings` command requires `settings` at root, repo, group, or conditional group level.

!!! tip "Multi-file directory config"
    When passing a directory to `-c`, xfg recursively scans subdirectories for `.yaml` and `.yml` files. See [Multi-File Configuration](../configuration/multi-file.md) for ordering rules and constraints.

## Definitions

Every definition below is generated from `config-schema.json`. Prose guides live under [Configuration](../configuration/index.md).

### fileConfig

<!-- xfg:generated schema:fileConfig -->

<!-- markdownlint-disable MD013 -->

Configuration for a single file to sync

| Field            | Type                                          | Required | Default   | Description                                                                                                                                                                                                                                                                                                            |
| ---------------- | --------------------------------------------- | -------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content`        | `object` \| `string` \| `string[]`            | No       | -         | File content. Object for JSON/YAML files, string or string[] for text files. Use @path/to/file to reference external template files (paths relative to config file). Supports ${VAR} env interpolation; use $${VAR} to output literal ${VAR}. Omit for empty file.                                                     |
| `mergeStrategy`  | `replace` \| `append` \| `prepend` \| `merge` | No       | `replace` | Array merge strategy for this file. 'replace' replaces arrays, 'append' adds overlay after base, 'prepend' adds overlay before base, 'merge' deep-merges items matched by identity key (type, actor_id). Default: replace                                                                                              |
| `createOnly`     | `boolean`                                     | No       | `false`   | If true, only create this file if it doesn't already exist in the target repo. Useful for files like .trivyignore or .prettierignore where you want to provide defaults but let repos customize. Default: false                                                                                                        |
| `header`         | `string` \| `string[]`                        | No       | -         | YAML only. Comment line(s) added at the top of YAML files. Each line gets a '# ' prefix. Ignored for JSON and text files.                                                                                                                                                                                              |
| `schemaUrl`      | `string`                                      | No       | -         | YAML only. URL for yaml-language-server schema directive. Adds '# yaml-language-server: $schema=\<url>' at the top of YAML files. For JSON files, use $schema property in content instead.                                                                                                                             |
| `executable`     | `boolean`                                     | No       | -         | Mark the file as executable via git update-index --add --chmod=+x. Shell scripts (.sh) are auto-executable unless explicitly set to false. Non-.sh files can be marked executable by setting to true.                                                                                                                  |
| `template`       | `boolean`                                     | No       | `false`   | Enable xfg templating for this file. When true, ${xfg:variable} placeholders are replaced with repo-specific values. Available variables: repo.name, repo.owner, repo.fullName, repo.url, repo.platform, repo.host, file.name, date, and any custom vars. Use $${xfg:...} to output literal ${xfg:...}. Default: false |
| `vars`           | `object` of `string`                          | No       | -         | Custom template variables for this file. Accessible as ${xfg:varName} when template: true. Per-repo vars merge with (and override) these root-level vars.                                                                                                                                                              |
| `deleteOrphaned` | `boolean`                                     | No       | `false`   | Track this file for orphan deletion. When true, if this file is removed from the config, it will be deleted from target repos. Tracked via .xfg.json manifest. Overrides global deleteOrphaned setting. Default: false                                                                                                 |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

### repo

<!-- xfg:generated schema:repo -->

<!-- markdownlint-disable MD013 -->

Repository configuration

| Field       | Type                                                           | Required | Default | Description                                                                                                                                                                                                                                                                              |
| ----------- | -------------------------------------------------------------- | -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git`       | `string` \| `string[]`                                         | Yes      | -       | Git repository URL(s). Supports GitHub (`git@github.com:owner/repo.git`, `https://github.com/owner/repo.git`) and Azure DevOps formats                                                                                                                                                   |
| `files`     | `object` of `false` \| [`repoFileOverride`](#repofileoverride) | No       | -       | Per-repo file overrides or exclusions. Keys must reference files defined in the root 'files' object. Set to false to exclude a file from this repo. Set inherit: false to skip all inherited files.                                                                                      |
| `groups`    | `string[]`                                                     | No       | -       | List of group names to apply to this repo. Groups are merged in order: root → group1 → group2 → repo overrides. Group names must reference groups defined in the root 'groups' object.                                                                                                   |
| `prOptions` | [`prOptions`](#proptions)                                      | No       | -       | Per-repo PR merge options. Overrides global prOptions.                                                                                                                                                                                                                                   |
| `settings`  | [`repoSettings`](#reposettings)                                | No       | -       | Per-repo settings including GitHub Rulesets. Merged with global settings: per-repo rulesets override root rulesets with same name.                                                                                                                                                       |
| `upstream`  | `string`                                                       | No       | -       | Fork upstream repo if target doesn't exist. When the target repo is missing, xfg forks from this URL instead of creating an empty repo. Mutually exclusive with 'source'. Supports SSH (`git@host:owner/repo.git`) and HTTPS (`https://host/owner/repo.git`) formats.                    |
| `source`    | `string`                                                       | No       | -       | Migrate from source repo if target doesn't exist. When the target repo is missing, xfg clones this repo with --mirror and pushes to the new target. Use for cross-platform migration (e.g., Azure DevOps to GitHub). Mutually exclusive with 'upstream'. Supports SSH and HTTPS formats. |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

!!! note "`upstream` and `source` are mutually exclusive"
    See [Repo Lifecycle](../configuration/lifecycle.md) for details.

### prOptions

<!-- xfg:generated schema:prOptions -->

<!-- markdownlint-disable MD013 -->

PR merge behavior options

| Field           | Type                                      | Required | Default  | Description                                                                                                                                                                                                                       |
| --------------- | ----------------------------------------- | -------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `merge`         | `manual` \| `auto` \| `force` \| `direct` | No       | `auto`   | Merge mode: 'manual' leaves PR open for review, 'auto' enables auto-merge when checks pass, 'force' bypasses requirements using admin privileges, 'direct' pushes directly to default branch without creating a PR. Default: auto |
| `mergeStrategy` | `merge` \| `squash` \| `rebase`           | No       | `squash` | How to merge the PR: 'merge' creates a merge commit, 'squash' squashes all commits, 'rebase' rebases commits onto base. Default: squash                                                                                           |
| `deleteBranch`  | `boolean`                                 | No       | `true`   | Delete the source branch after merge completes. Default: true                                                                                                                                                                     |
| `bypassReason`  | `string`                                  | No       | -        | Reason for bypassing policies (Azure DevOps only, required when merge=force)                                                                                                                                                      |
| `labels`        | `string[]`                                | No       | -        | Labels to apply to created PRs/MRs. Labels must exist on the target repository.                                                                                                                                                   |
| `branch`        | `string`                                  | No       | -        | Branch name for sync PRs. Per-repo overrides group, group overrides global. CLI --branch flag overrides all.                                                                                                                      |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

### repoFileOverride

<!-- xfg:generated schema:repoFileOverride -->

<!-- markdownlint-disable MD013 -->

Per-repo override for a specific file

| Field            | Type                               | Required | Default | Description                                                                                                                                                           |
| ---------------- | ---------------------------------- | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content`        | `object` \| `string` \| `string[]` | No       | -       | Content overlay merged onto the file's base content. Use @path/to/file to reference external template files. Must match the content type of the root file definition. |
| `override`       | `boolean`                          | No       | `false` | If true, use only this content and skip merging with base. Default: false                                                                                             |
| `createOnly`     | `boolean`                          | No       | -       | Override the root-level createOnly setting for this specific repo                                                                                                     |
| `header`         | `string` \| `string[]`             | No       | -       | YAML only. Override the root-level header for this specific repo. Ignored for JSON and text files.                                                                    |
| `schemaUrl`      | `string`                           | No       | -       | YAML only. Override the root-level schemaUrl for this specific repo. For JSON files, use $schema property in content instead.                                         |
| `executable`     | `boolean`                          | No       | -       | Override the root-level executable setting for this specific repo. Set to true to mark executable, or false to disable auto-executable behavior for .sh files.        |
| `template`       | `boolean`                          | No       | -       | Override the root-level template setting for this specific repo. Set to true to enable xfg templating, or false to disable it.                                        |
| `vars`           | `object` of `string`               | No       | -       | Per-repo custom template variables. These merge with (and override) root-level vars for this file. Accessible as ${xfg:varName} when template: true.                  |
| `deleteOrphaned` | `boolean`                          | No       | -       | Override the file-level or global deleteOrphaned setting for this specific repo. Set to true to enable orphan tracking, or false to disable it for this repo.         |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

### groupConfig

<!-- xfg:generated schema:groupConfig -->

<!-- markdownlint-disable MD013 -->

Configuration group that can define files, prOptions, and settings. Referenced by repos via 'groups: [groupName]'.

| Field       | Type                                                                                          | Required | Default | Description                                                                                                                                                                     |
| ----------- | --------------------------------------------------------------------------------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extends`   | `string` \| `string[]`                                                                        | No       | -       | Parent group name(s) to inherit files, settings, and PR options from. Accepts a single group name or an array of group names. Parents are merged before the child group.        |
| `files`     | `object` of `false` \| [`fileConfig`](#fileconfig) \| [`repoFileOverride`](#repofileoverride) | No       | -       | Files defined or overridden by this group. Keys are filenames. Set to false to remove an inherited file. Set inherit: false to discard all accumulated files from prior layers. |
| `prOptions` | [`prOptions`](#proptions)                                                                     | No       | -       | PR merge options for repos using this group. Overrides root prOptions, can be overridden by repo prOptions.                                                                     |
| `settings`  | [`repoSettings`](#reposettings)                                                               | No       | -       | Settings for repos using this group. Supports inherit: false on rulesets/labels sub-sections. Merged between root and repo settings.                                            |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

### conditionalGroupConfig

<!-- xfg:generated schema:conditionalGroupConfig -->

<!-- markdownlint-disable MD013 -->

Conditional group that activates based on which groups a repo has. Has a 'when' clause and the same files/prOptions/settings as regular groups.

| Field       | Type                                                                                          | Required | Default | Description                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------- | -------- | ------- | --------------------------------------------------------------------------------------------------------- |
| `when`      | `any`                                                                                         | Yes      | -       | Condition that determines when this group activates. At least one of allOf, anyOf, or noneOf is required. |
| `files`     | `object` of `false` \| [`fileConfig`](#fileconfig) \| [`repoFileOverride`](#repofileoverride) | No       | -       | Files defined or overridden by this conditional group. Same capabilities as regular group files.          |
| `prOptions` | [`prOptions`](#proptions)                                                                     | No       | -       | PR merge options for repos matching this condition.                                                       |
| `settings`  | [`repoSettings`](#reposettings)                                                               | No       | -       | Settings for repos matching this condition. Supports inherit: false on rulesets/labels sub-sections.      |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

See [Groups — Conditional Groups](../configuration/groups.md#conditional-groups).

### codeScanningSettings

<!-- xfg:generated schema:codeScanningSettings -->

<!-- markdownlint-disable MD013 -->

GitHub code scanning default setup configuration

| Field        | Type                                                                                                                    | Required | Default | Description                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- | -------- | ------- | ------------------------------------------------------------------------------------- |
| `state`      | `configured` \| `not-configured`                                                                                        | Yes      | -       | Enable or disable code scanning default setup                                         |
| `querySuite` | `default` \| `extended`                                                                                                 | No       | -       | Query suite to use: 'default' for standard queries, 'extended' for additional queries |
| `languages`  | `actions` \| `c-cpp` \| `csharp` \| `go` \| `java-kotlin` \| `javascript-typescript` \| `python` \| `ruby` \| `swift[]` | No       | -       | Languages to analyze. If omitted, GitHub auto-detects languages in the repository.    |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

### rootSettings

<!-- xfg:generated schema:rootSettings -->

<!-- markdownlint-disable MD013 -->

Global repository settings including GitHub Rulesets and repository features. inherit is not valid at root level.

| Field            | Type                                                   | Required | Default | Description                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------ | -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rulesets`       | `object` of `false` \| [`ruleset`](#ruleset)           | No       | -       | Map of ruleset names to configurations. Set a ruleset to false to disable it.                                                                                                                        |
| `repo`           | [`githubRepoSettings`](#githubreposettings)            | No       | -       | GitHub repository settings (features, merge options, security).                                                                                                                                      |
| `labels`         | `object` of `false` \| [`label`](#label)               | No       | -       | Map of label names to configurations. Set a label to false to disable it.                                                                                                                            |
| `codeScanning`   | [`codeScanningSettings`](#codescanningsettings)        | No       | -       | GitHub code scanning default setup configuration.                                                                                                                                                    |
| `variables`      | `object` of `false` \| `string`                        | No       | -       | Map of GitHub Actions variable names to values. Set a variable to false to disable it. Use deleteOrphaned to remove variables not in config.                                                         |
| `secrets`        | `object` of `false` \| [`secretConfig`](#secretconfig) | No       | -       | Map of GitHub Actions secret names to SecretConfig. Set a secret to false to disable it. Use deleteOrphaned to remove secrets not in config. Only synced by 'xfg secrets sync', never by 'xfg sync'. |
| `deleteOrphaned` | `boolean`                                              | No       | `false` | Track managed resources for orphan deletion. When true, if a ruleset or label is removed from the config, it will be deleted from the repo. Default: false                                           |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

See [Secrets](../configuration/secrets.md) and [GitHub Variables](../configuration/variables.md) for scoping rules and the `inherit` / `deleteOrphaned` interaction.

### repoSettings

<!-- xfg:generated schema:repoSettings -->

<!-- markdownlint-disable MD013 -->

Repository settings including GitHub Rulesets and repository features

| Field            | Type                                                       | Required | Default | Description                                                                                                                                                                                     |
| ---------------- | ---------------------------------------------------------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rulesets`       | `object` of `false` \| [`ruleset`](#ruleset)               | No       | -       | Map of ruleset names to configurations. Set a ruleset to false to opt out. Set inherit: false to skip all inherited rulesets.                                                                   |
| `repo`           | `false` \| [`githubRepoSettings`](#githubreposettings)     | No       | -       | GitHub repository settings (features, merge options, security). Set to false at per-repo level to opt out of inherited settings.                                                                |
| `labels`         | `object` of `false` \| [`label`](#label)                   | No       | -       | Map of label names to configurations. Set a label to false to opt out. Set inherit: false to skip all inherited labels.                                                                         |
| `codeScanning`   | `false` \| [`codeScanningSettings`](#codescanningsettings) | No       | -       | GitHub code scanning default setup configuration. Set to false at per-repo level to opt out of inherited settings.                                                                              |
| `variables`      | `object` of `false` \| `string`                            | No       | -       | Map of GitHub Actions variable names to values. Set a variable to false to opt out. Set inherit: false to skip all inherited variables.                                                         |
| `secrets`        | `object` of `false` \| [`secretConfig`](#secretconfig)     | No       | -       | Map of GitHub Actions secret names to SecretConfig. Set a secret to false to opt out. Set inherit: false to skip all inherited secrets. Only synced by 'xfg secrets sync', never by 'xfg sync'. |
| `deleteOrphaned` | `boolean`                                                  | No       | `false` | Track managed resources for orphan deletion. When true, if a ruleset or label is removed from the config, it will be deleted from the repo. Default: false                                      |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

### githubRepoSettings

<!-- xfg:generated schema:githubRepoSettings -->

<!-- markdownlint-disable MD013 -->

GitHub repository settings for features, merge options, and security

| Field                           | Type                                      | Required | Default | Description                                                                                                    |
| ------------------------------- | ----------------------------------------- | -------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| `description`                   | `string`                                  | No       | -       | Repository description. Used when creating new repositories via lifecycle management (upstream/source fields). |
| `hasIssues`                     | `boolean`                                 | No       | -       | Enable or disable GitHub Issues. Warning: Disabling may hide existing issues.                                  |
| `hasProjects`                   | `boolean`                                 | No       | -       | Enable or disable GitHub Projects. Warning: Disabling may hide existing projects.                              |
| `hasWiki`                       | `boolean`                                 | No       | -       | Enable or disable the repository wiki. Warning: Disabling may hide existing wiki content.                      |
| `hasDiscussions`                | `boolean`                                 | No       | -       | Enable or disable GitHub Discussions                                                                           |
| `isTemplate`                    | `boolean`                                 | No       | -       | Mark the repository as a template repository                                                                   |
| `allowForking`                  | `boolean`                                 | No       | -       | Allow forking of a private repository                                                                          |
| `visibility`                    | `public` \| `private` \| `internal`       | No       | -       | Repository visibility. Warning: Changing visibility may expose or hide repository content.                     |
| `archived`                      | `boolean`                                 | No       | -       | Archive the repository. Warning: Archived repositories are read-only.                                          |
| `allowSquashMerge`              | `boolean`                                 | No       | -       | Allow squash-merging pull requests                                                                             |
| `allowMergeCommit`              | `boolean`                                 | No       | -       | Allow merge commits for pull requests                                                                          |
| `allowRebaseMerge`              | `boolean`                                 | No       | -       | Allow rebase-merging pull requests                                                                             |
| `allowAutoMerge`                | `boolean`                                 | No       | -       | Allow auto-merge on pull requests                                                                              |
| `deleteBranchOnMerge`           | `boolean`                                 | No       | -       | Automatically delete head branches after pull requests are merged                                              |
| `allowUpdateBranch`             | `boolean`                                 | No       | -       | Show 'Update branch' button in pull requests                                                                   |
| `squashMergeCommitTitle`        | `PR_TITLE` \| `COMMIT_OR_PR_TITLE`        | No       | -       | Default title for squash merge commits                                                                         |
| `squashMergeCommitMessage`      | `PR_BODY` \| `COMMIT_MESSAGES` \| `BLANK` | No       | -       | Default message for squash merge commits                                                                       |
| `mergeCommitTitle`              | `PR_TITLE` \| `MERGE_MESSAGE`             | No       | -       | Default title for merge commits                                                                                |
| `mergeCommitMessage`            | `PR_BODY` \| `PR_TITLE` \| `BLANK`        | No       | -       | Default message for merge commits                                                                              |
| `vulnerabilityAlerts`           | `boolean`                                 | No       | -       | Enable or disable Dependabot vulnerability alerts                                                              |
| `automatedSecurityFixes`        | `boolean`                                 | No       | -       | Enable or disable Dependabot automated security fixes                                                          |
| `secretScanning`                | `boolean`                                 | No       | -       | Enable or disable secret scanning                                                                              |
| `secretScanningPushProtection`  | `boolean`                                 | No       | -       | Enable or disable secret scanning push protection                                                              |
| `privateVulnerabilityReporting` | `boolean`                                 | No       | -       | Enable or disable private vulnerability reporting                                                              |
| `webCommitSignoffRequired`      | `boolean`                                 | No       | -       | Require contributors to sign off on web-based commits                                                          |
| `defaultBranch`                 | `string`                                  | No       | -       | The default branch for the repository                                                                          |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

### arrayMergeDirective

<!-- xfg:generated schema:arrayMergeDirective -->

<!-- markdownlint-disable MD013 -->

Merge directive for arrays. Instead of replacing the base array, append, prepend, or deep-merge values with the inherited array.

| Field         | Type                                          | Required | Default | Description                                                                                                                                                                   |
| ------------- | --------------------------------------------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$arrayMerge` | `replace` \| `append` \| `prepend` \| `merge` | Yes      | -       | How to merge with the base array: 'append' adds after, 'prepend' adds before, 'replace' replaces entirely, 'merge' deep-merges items matched by identity key (type, actor_id) |
| `$values`     | `string[]`                                    | Yes      | -       | Values to merge with the base array                                                                                                                                           |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

### bypassActorsArrayMergeDirective

<!-- xfg:generated schema:bypassActorsArrayMergeDirective -->

<!-- markdownlint-disable MD013 -->

Merge directive for bypassActors array

| Field         | Type                                          | Required | Default | Description                      |
| ------------- | --------------------------------------------- | -------- | ------- | -------------------------------- |
| `$arrayMerge` | `replace` \| `append` \| `prepend` \| `merge` | Yes      | -       | How to merge with the base array |
| `$values`     | [`bypassActor`](#bypassactor)[]               | Yes      | -       | Bypass actor values to merge     |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

### rulesArrayMergeDirective

<!-- xfg:generated schema:rulesArrayMergeDirective -->

<!-- markdownlint-disable MD013 -->

Merge directive for rules array

| Field         | Type                                          | Required | Default | Description                      |
| ------------- | --------------------------------------------- | -------- | ------- | -------------------------------- |
| `$arrayMerge` | `replace` \| `append` \| `prepend` \| `merge` | Yes      | -       | How to merge with the base array |
| `$values`     | [`rulesetRule`](#rulesetrule)[]               | Yes      | -       | Rule values to merge             |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

### ruleset

<!-- xfg:generated schema:ruleset -->

<!-- markdownlint-disable MD013 -->

GitHub Ruleset configuration

| Field          | Type                                                                                                     | Required | Default  | Description                                                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------- | -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `target`       | `branch` \| `tag`                                                                                        | No       | `branch` | Target type: 'branch' for branch rules, 'tag' for tag rules. Default: branch                                                                   |
| `enforcement`  | `active` \| `disabled` \| `evaluate`                                                                     | No       | `active` | Enforcement level: 'active' enforces rules, 'disabled' turns off rules, 'evaluate' evaluates rules without blocking (dry run). Default: active |
| `bypassActors` | [`bypassActor`](#bypassactor)[] \| [`bypassActorsArrayMergeDirective`](#bypassactorsarraymergedirective) | No       | -        |                                                                                                                                                |
| `conditions`   | [`rulesetConditions`](#rulesetconditions)                                                                | No       | -        | Conditions for when this ruleset applies (which branches/tags to target)                                                                       |
| `rules`        | [`rulesetRule`](#rulesetrule)[] \| [`rulesArrayMergeDirective`](#rulesarraymergedirective)               | No       | -        |                                                                                                                                                |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

### bypassActor

<!-- xfg:generated schema:bypassActor -->

<!-- markdownlint-disable MD013 -->

Actor who can bypass ruleset restrictions

| Field        | Type                                   | Required | Default | Description                                                                                                                                                                 |
| ------------ | -------------------------------------- | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actorId`    | `integer`                              | Yes      | -       | The ID of the actor (team ID, user ID, or integration ID)                                                                                                                   |
| `actorType`  | `Team` \| `User` \| `Integration`      | Yes      | -       | Type of actor: Team, User, or Integration (GitHub App)                                                                                                                      |
| `bypassMode` | `always` \| `pull_request` \| `exempt` | No       | -       | When the actor can bypass: 'always' for all operations, 'pull_request' for PR operations only, 'exempt' to skip rule evaluation entirely (no bypass audit entry is created) |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

### rulesetConditions

<!-- xfg:generated schema:rulesetConditions -->

<!-- markdownlint-disable MD013 -->

Conditions for when the ruleset applies

| Field     | Type     | Required | Default | Description                          |
| --------- | -------- | -------- | ------- | ------------------------------------ |
| `refName` | `object` | No       | -       | Ref name patterns to include/exclude |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

### rulesetRule

<!-- xfg:generated schema:rulesetRule -->

<!-- markdownlint-disable MD013 -->

One of:

- [`pullRequestRule`](#pullrequestrule)
- [`requiredStatusChecksRule`](#requiredstatuschecksrule)
- [`requiredSignaturesRule`](#requiredsignaturesrule)
- [`requiredLinearHistoryRule`](#requiredlinearhistoryrule)
- [`nonFastForwardRule`](#nonfastforwardrule)
- [`creationRule`](#creationrule)
- [`deletionRule`](#deletionrule)
- [`updateRule`](#updaterule)
- [`requiredDeploymentsRule`](#requireddeploymentsrule)
- [`codeScanningRule`](#codescanningrule)
- [`codeQualityRule`](#codequalityrule)
- [`workflowsRule`](#workflowsrule)
- [`patternRule`](#patternrule)
- [`filePathRestrictionRule`](#filepathrestrictionrule)
- [`fileExtensionRestrictionRule`](#fileextensionrestrictionrule)
- [`maxFilePathLengthRule`](#maxfilepathlengthrule)
- [`maxFileSizeRule`](#maxfilesizerule)

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

### pullRequestRule

<!-- xfg:generated schema:pullRequestRule -->

<!-- markdownlint-disable MD013 -->

Require pull request before merging

| Field        | Type           | Required | Default | Description |
| ------------ | -------------- | -------- | ------- | ----------- |
| `type`       | `pull_request` | Yes      | -       |             |
| `parameters` | `object`       | No       | -       |             |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

### requiredReviewer

<!-- xfg:generated schema:requiredReviewer -->

<!-- markdownlint-disable MD013 -->

Required reviewer configuration for specific file patterns

| Field              | Type       | Required | Default | Description                                             |
| ------------------ | ---------- | -------- | ------- | ------------------------------------------------------- |
| `filePatterns`     | `string[]` | Yes      | -       | File path patterns that require this reviewer           |
| `minimumApprovals` | `integer`  | Yes      | -       | Minimum number of approvals required from this reviewer |
| `reviewer`         | `object`   | Yes      | -       |                                                         |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

### requiredStatusChecksRule

<!-- xfg:generated schema:requiredStatusChecksRule -->

<!-- markdownlint-disable MD013 -->

Require status checks to pass

| Field        | Type                     | Required | Default | Description |
| ------------ | ------------------------ | -------- | ------- | ----------- |
| `type`       | `required_status_checks` | Yes      | -       |             |
| `parameters` | `object`                 | No       | -       |             |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

### requiredSignaturesRule

<!-- xfg:generated schema:requiredSignaturesRule -->

<!-- markdownlint-disable MD013 -->

Require signed commits

| Field  | Type                  | Required | Default | Description |
| ------ | --------------------- | -------- | ------- | ----------- |
| `type` | `required_signatures` | Yes      | -       |             |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

### requiredLinearHistoryRule

<!-- xfg:generated schema:requiredLinearHistoryRule -->

<!-- markdownlint-disable MD013 -->

Require linear history (no merge commits)

| Field  | Type                      | Required | Default | Description |
| ------ | ------------------------- | -------- | ------- | ----------- |
| `type` | `required_linear_history` | Yes      | -       |             |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

### nonFastForwardRule

<!-- xfg:generated schema:nonFastForwardRule -->

<!-- markdownlint-disable MD013 -->

Prevent force pushes

| Field  | Type               | Required | Default | Description |
| ------ | ------------------ | -------- | ------- | ----------- |
| `type` | `non_fast_forward` | Yes      | -       |             |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

### creationRule

<!-- xfg:generated schema:creationRule -->

<!-- markdownlint-disable MD013 -->

Restrict ref creation

| Field  | Type       | Required | Default | Description |
| ------ | ---------- | -------- | ------- | ----------- |
| `type` | `creation` | Yes      | -       |             |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

### deletionRule

<!-- xfg:generated schema:deletionRule -->

<!-- markdownlint-disable MD013 -->

Restrict ref deletion

| Field  | Type       | Required | Default | Description |
| ------ | ---------- | -------- | ------- | ----------- |
| `type` | `deletion` | Yes      | -       |             |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

### updateRule

<!-- xfg:generated schema:updateRule -->

<!-- markdownlint-disable MD013 -->

Restrict updates to refs

| Field        | Type     | Required | Default | Description |
| ------------ | -------- | -------- | ------- | ----------- |
| `type`       | `update` | Yes      | -       |             |
| `parameters` | `object` | No       | -       |             |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

### requiredDeploymentsRule

<!-- xfg:generated schema:requiredDeploymentsRule -->

<!-- markdownlint-disable MD013 -->

Require deployments to succeed

| Field        | Type                   | Required | Default | Description |
| ------------ | ---------------------- | -------- | ------- | ----------- |
| `type`       | `required_deployments` | Yes      | -       |             |
| `parameters` | `object`               | No       | -       |             |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

### codeScanningRule

<!-- xfg:generated schema:codeScanningRule -->

<!-- markdownlint-disable MD013 -->

Require code scanning results

| Field        | Type            | Required | Default | Description |
| ------------ | --------------- | -------- | ------- | ----------- |
| `type`       | `code_scanning` | Yes      | -       |             |
| `parameters` | `object`        | No       | -       |             |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

### codeQualityRule

<!-- xfg:generated schema:codeQualityRule -->

<!-- markdownlint-disable MD013 -->

Require code quality checks

| Field        | Type           | Required | Default | Description |
| ------------ | -------------- | -------- | ------- | ----------- |
| `type`       | `code_quality` | Yes      | -       |             |
| `parameters` | `object`       | No       | -       |             |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

### workflowsRule

<!-- xfg:generated schema:workflowsRule -->

<!-- markdownlint-disable MD013 -->

Require specific workflows to pass

| Field        | Type        | Required | Default | Description |
| ------------ | ----------- | -------- | ------- | ----------- |
| `type`       | `workflows` | Yes      | -       |             |
| `parameters` | `object`    | No       | -       |             |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

### patternRule

<!-- xfg:generated schema:patternRule -->

<!-- markdownlint-disable MD013 -->

Pattern-based rules for commit messages, author emails, etc.

| Field        | Type                                                                                                                                  | Required | Default | Description       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------- | ----------------- |
| `type`       | `commit_author_email_pattern` \| `commit_message_pattern` \| `committer_email_pattern` \| `branch_name_pattern` \| `tag_name_pattern` | Yes      | -       | Pattern rule type |
| `parameters` | `object`                                                                                                                              | Yes      | -       |                   |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

### filePathRestrictionRule

<!-- xfg:generated schema:filePathRestrictionRule -->

<!-- markdownlint-disable MD013 -->

Restrict changes to specific file paths

| Field        | Type                    | Required | Default | Description |
| ------------ | ----------------------- | -------- | ------- | ----------- |
| `type`       | `file_path_restriction` | Yes      | -       |             |
| `parameters` | `object`                | No       | -       |             |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

### fileExtensionRestrictionRule

<!-- xfg:generated schema:fileExtensionRestrictionRule -->

<!-- markdownlint-disable MD013 -->

Restrict changes to files with specific extensions

| Field        | Type                         | Required | Default | Description |
| ------------ | ---------------------------- | -------- | ------- | ----------- |
| `type`       | `file_extension_restriction` | Yes      | -       |             |
| `parameters` | `object`                     | No       | -       |             |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

### maxFilePathLengthRule

<!-- xfg:generated schema:maxFilePathLengthRule -->

<!-- markdownlint-disable MD013 -->

Restrict maximum file path length

| Field        | Type                   | Required | Default | Description |
| ------------ | ---------------------- | -------- | ------- | ----------- |
| `type`       | `max_file_path_length` | Yes      | -       |             |
| `parameters` | `object`               | No       | -       |             |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

### maxFileSizeRule

<!-- xfg:generated schema:maxFileSizeRule -->

<!-- markdownlint-disable MD013 -->

Restrict maximum file size

| Field        | Type            | Required | Default | Description |
| ------------ | --------------- | -------- | ------- | ----------- |
| `type`       | `max_file_size` | Yes      | -       |             |
| `parameters` | `object`        | No       | -       |             |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

### label

<!-- xfg:generated schema:label -->

<!-- markdownlint-disable MD013 -->

GitHub label configuration

| Field         | Type     | Required | Default | Description                                                        |
| ------------- | -------- | -------- | ------- | ------------------------------------------------------------------ |
| `color`       | `string` | Yes      | -       | Hex color code (with or without #). Example: 'd73a4a' or '#d73a4a' |
| `description` | `string` | No       | -       | Label description (max 100 characters)                             |
| `new_name`    | `string` | No       | -       | Rename this label. Maps to GitHub API's new_name field.            |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

### secretConfig

<!-- xfg:generated schema:secretConfig -->

<!-- markdownlint-disable MD013 -->

Secret configuration mapping to an environment variable source

| Field | Type     | Required | Default | Description                                                  |
| ----- | -------- | -------- | ------- | ------------------------------------------------------------ |
| `env` | `string` | Yes      | -       | Name of the environment variable containing the secret value |

<!-- markdownlint-enable MD013 -->

<!-- xfg:generated:end -->

## Validation

The schema validates:

- Required fields (`id`, `repos`, at least one of `files`, `settings`, or `groups`)
- Command-specific requirements (see below)
- Enum values (`mergeStrategy`, `merge`, etc.)
- Content types (object for JSON/YAML, string/array for text files)
- File path security (no path traversal in file references)

### Config Requirements

The `xfg sync` command accepts configs with files, settings, or both. At least one of `files`, `settings`, `groups`, or `conditionalGroups` must be present.
