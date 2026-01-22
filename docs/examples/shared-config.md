# Shared Config Across Teams

Define common settings once, customize per team.

## Example

```yaml
files:
  service.config.json:
    content:
      version: "2.0"
      logging:
        level: info
        format: json
      features:
        - health-check
        - metrics

repos:
  # Platform team repos - add extra features
  - git:
      - git@github.com:org/api-gateway.git
      - git@github.com:org/auth-service.git
    files:
      service.config.json:
        content:
          team: platform
          features:
            $arrayMerge: append
            values:
              - tracing
              - rate-limiting

  # Data team repos - different logging
  - git:
      - git@github.com:org/data-pipeline.git
      - git@github.com:org/analytics.git
    files:
      service.config.json:
        content:
          team: data
          logging:
            level: debug

  # Legacy service - completely different config
  - git: git@github.com:org/legacy-api.git
    files:
      service.config.json:
        override: true
        content:
          version: "1.0"
          legacy: true
```

## Results

**Platform team repos** get:

```json
{
  "version": "2.0",
  "logging": { "level": "info", "format": "json" },
  "features": ["health-check", "metrics", "tracing", "rate-limiting"],
  "team": "platform"
}
```

**Data team repos** get:

```json
{
  "version": "2.0",
  "logging": { "level": "debug", "format": "json" },
  "features": ["health-check", "metrics"],
  "team": "data"
}
```

**Legacy service** gets (override ignores base):

```json
{
  "version": "1.0",
  "legacy": true
}
```
