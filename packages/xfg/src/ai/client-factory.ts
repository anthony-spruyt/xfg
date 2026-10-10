import { ValidationError } from "../shared/errors.js";
import {
  assertAiBaseUrlEnvAllowed,
  assertAiHeadersEnvAllowed,
  assertAiKeyEnvAllowed,
  defaultAiKeyEnv,
  isDefaultAiBaseUrl,
} from "../shared/credential-env.js";
import {
  AnthropicClient,
  DEFAULT_ANTHROPIC_MODEL,
} from "./anthropic-client.js";
import {
  DEFAULT_OPENAI_BASE_URL,
  OpenAICompatibleClient,
} from "./openai-compatible-client.js";
import type {
  AiProviderOptions,
  FetchFn,
  IAiClient,
  JsonSchema,
} from "./types.js";

/** The default key env only applies to the provider's own API. */
function keyEnvFor(options: AiProviderOptions): string | undefined {
  if (options.apiKeyEnv !== undefined) return options.apiKeyEnv;
  return isDefaultAiBaseUrl(options.provider, options.baseUrl)
    ? defaultAiKeyEnv(options.provider)
    : undefined;
}

// undici refuses CR, LF, NUL and non-Latin-1 in header values and echoes the value in its error.
function isValidHeaderValue(value: string): boolean {
  return !/[\n\r\u0100-\uffff]/.test(value) && !value.includes("\0");
}

// undici trims surrounding whitespace before sending, so a trailing newline is harmless.
function readEnv(
  env: Record<string, string | undefined>,
  name: string
): string | undefined {
  return env[name]?.trim();
}

function readApiKey(
  env: Record<string, string | undefined>,
  keyEnv: string
): string | undefined {
  const value = readEnv(env, keyEnv);
  if (value && !isValidHeaderValue(value)) {
    throw new ValidationError(`${keyEnv} holds an invalid API key value`);
  }
  return value;
}

function resolveBaseUrl(
  options: AiProviderOptions,
  env: Record<string, string | undefined>,
  path: string
): string | undefined {
  assertAiBaseUrlEnvAllowed(options.baseUrlEnv, options.baseUrl, path);
  if (options.baseUrlEnv === undefined) return options.baseUrl;
  const value = readEnv(env, options.baseUrlEnv);
  if (!value) {
    throw new ValidationError(
      `${options.baseUrlEnv} is not set (required for ${path}.baseUrlEnv)`
    );
  }
  if (!isHttpUrl(value)) {
    throw new ValidationError(
      `${options.baseUrlEnv} does not hold an http(s) URL (used for ${path}.baseUrlEnv)`
    );
  }
  return value;
}

// Userinfo is refused because undici rejects it and echoes the whole URL in its error.
function isHttpUrl(value: string): boolean {
  try {
    const { protocol, username, password } = new URL(value);
    if (username || password) return false;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/** Replaces the resolved host in error text with the env var name that supplied it. */
class HostRedactingClient implements IAiClient {
  private readonly pattern: RegExp;

  constructor(
    private readonly inner: IAiClient,
    baseUrl: string,
    private readonly envName: string
  ) {
    const { host, hostname } = new URL(baseUrl);
    const hosts = [...new Set([host, hostname])].sort(
      (a, b) => b.length - a.length
    );
    this.pattern = new RegExp(hosts.map(escapeRegExp).join("|"), "gi");
  }

  async complete(
    system: string,
    user: string,
    schema?: JsonSchema
  ): Promise<string> {
    try {
      return await this.inner.complete(system, user, schema);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      const redacted = new Error(
        error.message.replace(this.pattern, () => this.envName)
      );
      // Keep fields such as retryAfter that withRetry reads.
      throw Object.assign(redacted, { ...error });
    }
  }
}

function resolveHeaders(
  options: AiProviderOptions,
  env: Record<string, string | undefined>,
  path: string
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, envName] of Object.entries(options.headersEnv ?? {})) {
    const value = readEnv(env, envName);
    if (!value) {
      throw new ValidationError(
        `${envName} is not set (required for ${path}.headersEnv '${name}')`
      );
    }
    if (!isValidHeaderValue(value)) {
      throw new ValidationError(
        `${envName} holds an invalid header value (used for ${path}.headersEnv '${name}')`
      );
    }
    headers[name] = value;
  }
  return headers;
}

function buildClient(
  options: AiProviderOptions,
  env: Record<string, string | undefined>,
  fetch: FetchFn,
  path: string
): IAiClient {
  assertAiKeyEnvAllowed(
    options.provider,
    options.apiKeyEnv,
    options.baseUrl,
    path
  );
  assertAiHeadersEnvAllowed(options.headersEnv, path);
  const keyEnv = keyEnvFor(options);

  if (options.provider === "anthropic") {
    if (keyEnv === undefined) {
      throw new ValidationError(
        `${path}.apiKeyEnv is required for provider 'anthropic' with a custom baseUrl`
      );
    }
    const apiKey = readApiKey(env, keyEnv);
    if (!apiKey) {
      throw new ValidationError(
        `${keyEnv} is not set (required for ${path} provider 'anthropic')`
      );
    }
    return new AnthropicClient({
      apiKey,
      model: options.model ?? DEFAULT_ANTHROPIC_MODEL,
      baseUrl: options.baseUrl,
      headers: resolveHeaders(options, env, path),
      fetch,
    });
  }

  if (!options.model) {
    throw new ValidationError(
      `${path}.model is required when provider is 'openai'`
    );
  }
  const apiKey = keyEnv === undefined ? undefined : readApiKey(env, keyEnv);
  // A custom baseUrl (Ollama, local LiteLLM) often needs no key at all.
  if (!apiKey && !options.baseUrl) {
    throw new ValidationError(
      `${keyEnv} is not set (required for ${path} provider 'openai' without baseUrl)`
    );
  }
  return new OpenAICompatibleClient({
    apiKey,
    model: options.model,
    baseUrl: options.baseUrl ?? DEFAULT_OPENAI_BASE_URL,
    headers: resolveHeaders(options, env, path),
    fetch,
  });
}

export function createAiClient(
  configured: AiProviderOptions,
  env: Record<string, string | undefined>,
  fetch: FetchFn,
  path = "prOptions.ai"
): IAiClient {
  const options = {
    ...configured,
    baseUrl: resolveBaseUrl(configured, env, path),
  };
  const client = buildClient(options, env, fetch, path);
  if (options.baseUrlEnv === undefined || options.baseUrl === undefined) {
    return client;
  }
  return new HostRedactingClient(client, options.baseUrl, options.baseUrlEnv);
}
