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

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: "20.x"
  - script: npm install -g @aspruyt/xfg
    displayName: "Install xfg"
  - script: xfg sync --config ./config.yaml
    displayName: "Sync configs"
    env:
      AZURE_DEVOPS_EXT_PAT: $(System.AccessToken)
```

## Token Requirements

!!! note "Build Service Permissions"
Ensure the build service account has permission to create PRs in target repositories.

### Using System.AccessToken

The `$(System.AccessToken)` provides access within the same Azure DevOps organization. For cross-organization access, use a PAT:

```yaml
- script: xfg sync --config ./config.yaml
  displayName: "Sync configs"
  env:
    AZURE_DEVOPS_EXT_PAT: $(MY_PAT)
```

Where `MY_PAT` is a pipeline variable containing your Personal Access Token.

## Multiple Config Files

```yaml
trigger:
  branches:
    include: [main]
  paths:
    include: ["configs/*"]

pool:
  vmImage: "ubuntu-latest"

strategy:
  matrix:
    eslint:
      configFile: "eslint-config.yaml"
    prettier:
      configFile: "prettier-config.yaml"

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: "20.x"
  - script: npm install -g @aspruyt/xfg
    displayName: "Install xfg"
  - script: xfg sync --config ./configs/$(configFile)
    displayName: "Sync $(configFile)"
    env:
      AZURE_DEVOPS_EXT_PAT: $(System.AccessToken)
```
