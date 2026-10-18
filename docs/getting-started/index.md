# Installation

## Requirements

- Node.js 22 or later
- `git`
- The CLI for each platform you target (`gh`, `az`, `glab`). See [Prerequisites](prerequisites.md).

## From npm

```bash
npm install -g @aspruyt/xfg
```

## From Source

```bash
git clone https://github.com/anthony-spruyt/xfg.git
cd xfg/packages/xfg
npm install
npm run build
```

Run the build with `node dist/cli.js sync --config ./config.yaml`.

## Using Dev Container

Open this repository in VS Code with the Dev Containers extension. The container includes all dependencies pre-installed and the project pre-built.

## Next Steps

After installation, you'll need to authenticate with your Git platform:

- [GitHub Authentication](prerequisites.md#github-authentication)
- [Azure DevOps Authentication](prerequisites.md#azure-devops-authentication)
- [GitLab Authentication](prerequisites.md#gitlab-authentication)
