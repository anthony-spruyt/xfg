# Azure Pipelines

## Pipeline Example

```yaml
trigger:
  branches:
    include: [main]
  paths:
    include: ["config.yaml"]

pool:
  vmImage: "ubuntu-latest"

resources:
  repositories:
    - repository: target1
      type: git
      name: MyProject/target-repo-1
    - repository: target2
      type: git
      name: MyProject/target-repo-2

jobs:
  - job: sync
    uses:
      repositories: [target1, target2]
    steps:
      - task: NodeTool@0
        inputs:
          versionSpec: "24.x"
      - script: npm install -g @aspruyt/xfg
        displayName: "Install xfg"
      - script: |
          git config --global user.name "Azure Pipelines"
          git config --global user.email "azure-pipelines@example.com"
        displayName: "Configure git identity"
      - script: |
          git config --global http.https://dev.azure.com/.extraheader "AUTHORIZATION: bearer $(System.AccessToken)"
        displayName: "Configure git credentials"
      - script: xfg sync --config ./config.yaml
        displayName: "Sync configs"
        env:
          AZURE_DEVOPS_EXT_PAT: $(System.AccessToken)
```

The `resources` and `uses` blocks list the target repositories. [Repository access](#repository-access) explains why the job needs them.

## Token Requirements

!!! note "Build Service Permissions"
    Ensure the build service account has permission to create PRs in target repositories.

xfg runs `git commit` and sets no author identity, so the pipeline configures one. xfg passes tokens to `git` only for GitHub repositories: for Azure DevOps, `git` clones and pushes with the credentials configured on the agent, so the pipeline sets an `http.extraheader` for `https://dev.azure.com/` that carries `$(System.AccessToken)`. `AZURE_DEVOPS_EXT_PAT` is read by the `az` CLI.

The `http.extraheader` applies to `https://dev.azure.com/` URLs only, so list target repositories as `https://dev.azure.com/org/project/_git/repo`. A `git@ssh.dev.azure.com:` URL does not use it and needs SSH keys set up on the agent.

### Repository access

With **Protect access to repositories in YAML pipelines** on, `git` in a script reaches only the Azure Repos Git repositories that the job references. Azure DevOps enables the setting by default for organizations and projects created after May 2020.

Declare each target repository as a repository resource and list it under the job's `uses`, as in the example above, or reference it in a `checkout` step. A script that supplies its own PAT needs no reference, so use the PAT variant below when listing every repository is impractical.

If a target repository is in another project, the build service identity also needs access to that project when **Limit job authorization scope to current project** is on.

### Using System.AccessToken

The `$(System.AccessToken)` provides access within the same Azure DevOps organization, to the repositories the job references. For cross-organization access, or to skip the repository references, use a PAT for both `git` and the `az` CLI. `git` takes it as a base64-encoded basic auth header:

```yaml
- script: |
    AUTH=$(printf ':%s' "$MY_PAT" | base64 -w0)
    git config --global http.https://dev.azure.com/.extraheader "AUTHORIZATION: basic $AUTH"
  displayName: "Configure git credentials"
  env:
    MY_PAT: $(MY_PAT)
- script: xfg sync --config ./config.yaml
  displayName: "Sync configs"
  env:
    AZURE_DEVOPS_EXT_PAT: $(MY_PAT)
```

Where `MY_PAT` is a secret pipeline variable containing your Personal Access Token. Secret variables reach scripts only through `env`.

## Multiple Config Files

```yaml
trigger:
  branches:
    include: [main]
  paths:
    include: ["configs/*"]

pool:
  vmImage: "ubuntu-latest"

resources:
  repositories:
    - repository: target1
      type: git
      name: MyProject/target-repo-1
    - repository: target2
      type: git
      name: MyProject/target-repo-2

jobs:
  - job: sync
    uses:
      repositories: [target1, target2]
    strategy:
      matrix:
        eslint:
          configFile: "eslint-config.yaml"
        prettier:
          configFile: "prettier-config.yaml"
    steps:
      - task: NodeTool@0
        inputs:
          versionSpec: "24.x"
      - script: npm install -g @aspruyt/xfg
        displayName: "Install xfg"
      - script: |
          git config --global user.name "Azure Pipelines"
          git config --global user.email "azure-pipelines@example.com"
        displayName: "Configure git identity"
      - script: |
          git config --global http.https://dev.azure.com/.extraheader "AUTHORIZATION: bearer $(System.AccessToken)"
        displayName: "Configure git credentials"
      - script: xfg sync --config ./configs/$(configFile)
        displayName: "Sync $(configFile)"
        env:
          AZURE_DEVOPS_EXT_PAT: $(System.AccessToken)
```
