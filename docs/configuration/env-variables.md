# Environment Variables

Use `${VAR}` syntax in string values to inject environment variables at runtime.

## Syntax Options

| Syntax            | Behavior                                 |
| ----------------- | ---------------------------------------- |
| `${VAR}`          | Required - errors if not set             |
| `${VAR:-default}` | Use default value if variable is not set |
| `${VAR:?message}` | Required with custom error message       |

## Example

```yaml
files:
  app.config.json:
    content:
      apiUrl: ${API_URL} # Required
      environment: ${ENV:-development} # With default
      secretKey: ${SECRET:?Secret required} # Required with message

repos:
  - git: git@github.com:org/backend.git
```

Then run with environment variables:

```bash
export API_URL=https://api.example.com
export SECRET=my-secret-key
xfg --config ./config.yaml
```

## Escaping Variable Syntax

If your target file needs literal `${VAR}` syntax (e.g., for devcontainer.json, shell scripts, or other templating systems), use `$$` to escape:

```yaml
files:
  .devcontainer/devcontainer.json:
    content:
      name: my-dev-container
      remoteEnv:
        # Escaped - outputs literal ${localWorkspaceFolder}
        LOCAL_WORKSPACE_FOLDER: "$${localWorkspaceFolder}"
        CONTAINER_WORKSPACE: "$${containerWorkspaceFolder}"
        # Interpolated - replaced with actual env value
        API_KEY: "${API_KEY}"
```

Output:

```json
{
  "name": "my-dev-container",
  "remoteEnv": {
    "LOCAL_WORKSPACE_FOLDER": "${localWorkspaceFolder}",
    "CONTAINER_WORKSPACE": "${containerWorkspaceFolder}",
    "API_KEY": "actual-api-key-value"
  }
}
```

This follows the same escape convention used by Docker Compose.

## Full Example

```yaml
files:
  app.config.json:
    content:
      database:
        host: ${DB_HOST:-localhost}
        port: ${DB_PORT:-5432}
        password: ${DB_PASSWORD:?Database password required}

      api:
        baseUrl: ${API_BASE_URL}
        timeout: 30000

repos:
  - git: git@github.com:org/backend.git
```
