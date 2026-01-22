# Environment-Specific Values

Use environment variables for secrets and environment-specific values.

## Example

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

## Running with Environment Variables

```bash
export DB_HOST=prod-db.example.com
export DB_PORT=5432
export DB_PASSWORD=secret123
export API_BASE_URL=https://api.example.com

xfg --config ./config.yaml
```

## Result

```json
{
  "database": {
    "host": "prod-db.example.com",
    "port": "5432",
    "password": "secret123"
  },
  "api": {
    "baseUrl": "https://api.example.com",
    "timeout": 30000
  }
}
```

## Syntax Reference

| Syntax            | Behavior                                 |
| ----------------- | ---------------------------------------- |
| `${VAR}`          | Required - errors if not set             |
| `${VAR:-default}` | Use default value if variable is not set |
| `${VAR:?message}` | Required with custom error message       |
| `$${VAR}`         | Escape - outputs literal `${VAR}`        |
