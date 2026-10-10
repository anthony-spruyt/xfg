# AI Commit Messages

By default every sync commit and PR gets a generic message such as `chore: sync 6 config files`.

Turn on `prOptions.ai` and xfg asks an LLM to read the diff and write a [Conventional Commits](https://www.conventionalcommits.org/) message that says what actually changed:

```text
ci(workflows): pin actions/checkout to v5

Bumps actions/checkout from v4 to v5 in the CI and release workflows.
```

It applies to every sync commit, including `merge: direct` pushes. In PR mode, xfg also uses the AI subject as the PR title and adds a short AI summary to the PR body.

When a sync changes more than one area, the subject drops the scope and names them all (or sums them up when they don't fit) and the body has one bullet per area. Each bullet names what changed and says what it does in plain words, so `git log --grep` finds it. File names are left out: `git log --stat` already lists them.

```text
chore: update devcontainer and ci

- update the shared dev container tooling to devcontainer-common v2.3.4
- cancel superseded CI runs when a PR gets a new push
```

AI is opt-in. If anything goes wrong (missing key, network error, a reply that is not a valid conventional commit), xfg logs a warning and uses the default message, after trying the [fallback provider](#fallback-provider) if one is set. The sync never fails because of AI.

## Quick Start

```yaml
prOptions:
  ai: true
```

```bash
export ANTHROPIC_API_KEY=sk-ant-...
xfg sync --config config.yaml
```

`ai: true` is shorthand for `{ provider: anthropic }` with model `claude-haiku-4-5`.

## Options

```yaml
prOptions:
  ai:
    provider: anthropic # anthropic | openai
    model: claude-haiku-4-5 # default for anthropic; required for openai
    baseUrl: https://api.anthropic.com # optional
    apiKeyEnv: MY_KEY # optional; defaults to ANTHROPIC_API_KEY / OPENAI_API_KEY
    headersEnv: # optional; header name: env var that holds its value
      X-Team: TEAM_HEADER_VALUE
    fallback: # optional; tried when the provider above fails
      provider: openai
      model: gpt-4o-mini
    prompt: "Mention the Jira ticket if the diff has one." # optional
    maxDiffChars: 20000 # optional
```

| Field          | Description                                                                                                | Default                                |
| -------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `provider`     | `anthropic` (Claude Messages API) or `openai` (any OpenAI-compatible Chat Completions API)                 | `anthropic`                            |
| `model`        | Model id                                                                                                   | `claude-haiku-4-5` for `anthropic`     |
| `baseUrl`      | API base URL. With `openai`, setting it makes the API key optional                                         | Provider default                       |
| `apiKeyEnv`    | Name of the env var that holds the API key                                                                 | `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` |
| `headersEnv`   | Extra HTTP headers, as header name to env var name. See [Headers](#headers)                                | -                                      |
| `fallback`     | A second provider, tried when this one fails. See [Fallback provider](#fallback-provider)                  | -                                      |
| `prompt`       | Extra instructions appended to the built-in prompt                                                         | -                                      |
| `maxDiffChars` | Maximum diff characters sent. Small diffs are sent whole; large diffs share what is left and get truncated | `20000`                                |

The default key (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) is only sent to that provider's own API. With any other `baseUrl`, name a dedicated variable in `apiKeyEnv`. `apiKeyEnv` can't name a credential xfg uses elsewhere, such as `GH_TOKEN` (see [Environment Variables](env-variables.md#credential-variables)).

`ai` lives on `prOptions`, so it follows the normal root → group → repo override chain. An `ai` object at a lower level replaces the one above it (it is not deep-merged). Set `ai: false` on a repo or group to turn it off there. A later `ai: true` turns it back on with the `ai` object from above.

### Headers

`headersEnv` sends extra HTTP headers with every request to that provider, for gateways that sit behind an access proxy. Each entry maps a header name to the **name of an env var**; the value is read from the environment at run time and never written in config.

```yaml
prOptions:
  ai:
    provider: openai
    baseUrl: https://gateway.example.com/v1
    model: my-model
    apiKeyEnv: GATEWAY_API_KEY
    headersEnv:
      CF-Access-Client-Id: CF_ACCESS_CLIENT_ID
      CF-Access-Client-Secret: CF_ACCESS_CLIENT_SECRET
```

- If any named env var is unset or empty, xfg skips that provider with a warning, as it does for a missing API key. It never sends an empty header.
- Like `apiKeyEnv`, a header can't name a credential xfg uses elsewhere, such as `GH_TOKEN` (see [Environment Variables](env-variables.md#credential-variables)).
- Header names xfg sets itself (`Authorization`, `x-api-key`, `anthropic-version`, `Content-Type`, `Content-Length`, `Host`) are rejected.
- xfg doesn't follow HTTP redirects for any AI provider. A redirect counts as a failure, so the `fallback` provider runs if one is set.

### Fallback provider

`fallback` takes one more provider with the same fields as `ai` (`provider`, `model`, `baseUrl`, `apiKeyEnv`, `headersEnv`, `prompt`, `maxDiffChars`), but no nested `fallback`. xfg tries it when the primary fails for any reason: a missing API key or header env var, a network error, a timeout, a non-2xx status, or a reply that is not a valid conventional commit.

- `prompt` and `maxDiffChars` default to the primary's, so the fallback follows the same rules. `model`, `baseUrl`, `apiKeyEnv` and `headersEnv` are not inherited.
- The same key rule applies: the default `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` is only sent to that provider's own API, so name a dedicated `apiKeyEnv` for any other `baseUrl`.
- If the fallback fails too, xfg warns and uses the default message. The sync never fails because of AI.

#### Timeouts and retries

Each request times out after 60 seconds, and connecting to a host that does not answer gives up after 10 seconds. With a `fallback` set, the primary is tried once without `--retries`, so an unreachable gateway costs one connect timeout, not a full retry cycle. The fallback gets the normal `--retries`.

## Providers

### Anthropic

```yaml
prOptions:
  ai:
    provider: anthropic
    model: claude-haiku-4-5
```

Needs `ANTHROPIC_API_KEY` (or the variable named in `apiKeyEnv`).

### OpenAI

```yaml
prOptions:
  ai:
    provider: openai
    model: gpt-4o-mini
```

Needs `OPENAI_API_KEY`.

### Ollama (local, no key)

```yaml
prOptions:
  ai:
    provider: openai
    model: llama3.1
    baseUrl: http://localhost:11434/v1
```

No API key is needed when `baseUrl` is set. Diffs never leave your machine.

### OpenRouter

OpenRouter speaks both protocols. Keep the provider and change only the URL and key.

```yaml
prOptions:
  ai:
    provider: anthropic
    baseUrl: https://openrouter.ai/api
    apiKeyEnv: OPENROUTER_API_KEY
    model: anthropic/claude-haiku-4.5
```

or

```yaml
prOptions:
  ai:
    provider: openai
    baseUrl: https://openrouter.ai/api/v1
    apiKeyEnv: OPENROUTER_API_KEY
    model: openai/gpt-4o-mini
```

Needs `OPENROUTER_API_KEY`. Any [OpenRouter model](https://openrouter.ai/models) id works.

### Azure OpenAI, LiteLLM and other gateways

Any service that speaks the OpenAI Chat Completions API works with `provider: openai` and a `baseUrl`. If it needs a key, point `apiKeyEnv` at it. If the gateway needs extra headers, add them with [`headersEnv`](#headers).

### Gateway with fallback

A self-hosted gateway behind an access proxy, with a hosted provider as a backup:

```yaml
prOptions:
  ai:
    provider: openai
    baseUrl: https://gateway.example.com/v1
    model: provider/small-model
    apiKeyEnv: GATEWAY_API_KEY
    headersEnv:
      CF-Access-Client-Id: CF_ACCESS_CLIENT_ID
      CF-Access-Client-Secret: CF_ACCESS_CLIENT_SECRET
    fallback:
      provider: openai
      baseUrl: https://openrouter.ai/api/v1
      model: anthropic/claude-haiku-4.5
      apiKeyEnv: OPENROUTER_API_KEY
```

```bash
export GATEWAY_API_KEY=...
export CF_ACCESS_CLIENT_ID=...
export CF_ACCESS_CLIENT_SECRET=...
export OPENROUTER_API_KEY=...
xfg sync --config config.yaml
```

When the gateway answers, the fallback is never called. When it is down, unreachable, or missing a variable, xfg logs a warning and asks OpenRouter instead.

## Disabling AI

- Per repo or group: `prOptions: { ai: false }`
- Whole run: `xfg sync --no-ai`
- GitHub Action: `no-ai: true`

`--dry-run` never calls the provider. It only logs `Would generate AI commit message`.

## PR Descriptions

In PR mode the AI summary fills the [`${xfg:pr.aiSummary}`](pr-templates.md#available-variables) template variable. The default template shows it under **Summary**.

If your custom `prTemplate` does not use `${xfg:pr.aiSummary}`, xfg appends it at the end under an `## AI Summary` heading.

Each sync closes the previous xfg PR and opens a fresh one, so the title and summary always describe the latest change.

The model's text is shaped by the diffs, so xfg defuses it before use: `@mentions` are wrapped in backticks and issue-closing keywords (`Fixes #42`, `Closes https://...`) become `Refs`. That stops an AI message from pinging people or closing issues.

## Privacy

!!! warning "Diffs are sent to the provider"
    With `anthropic`, or `openai` without a local `baseUrl`, xfg sends the file paths and diffs of every synced change to that provider. Diffs are computed **after** `${ENV}` interpolation, so any secret you interpolate into file content is sent too. Do not enable AI for files that contain interpolated secrets, or use a local model such as Ollama.

With a [`fallback`](#fallback-provider), the same payload goes to the fallback provider when the primary fails.

xfg sends only the paths, change types (create/update/delete) and diffs, capped at `maxDiffChars`. It does not send repo names, tokens or anything else.

## Cost and Caching

- The default model is Claude Haiku 4.5, the cheapest Claude model but not the cheapest overall. Small models such as `openai/gpt-4o-mini` via [OpenRouter](#openrouter) cost several times less and write fine commit messages.
- Diffs are capped at `maxDiffChars` (20,000 characters by default).
- Responses are cached in memory for the run. The cache key is the prompt plus provider settings, including the fallback. When 50 repos get the exact same change, xfg makes one API call, not 50.
- Transient errors (429, 5xx, timeouts) are retried with the same `--retries` setting as git operations.
