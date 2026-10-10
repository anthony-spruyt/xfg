import { ValidationError } from "../shared/errors.js";
import {
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
import type { AiProviderOptions, FetchFn, IAiClient } from "./types.js";

/** The default key env only applies to the provider's own API. */
function keyEnvFor(options: AiProviderOptions): string | undefined {
  if (options.apiKeyEnv !== undefined) return options.apiKeyEnv;
  return isDefaultAiBaseUrl(options.provider, options.baseUrl)
    ? defaultAiKeyEnv(options.provider)
    : undefined;
}

function resolveHeaders(
  options: AiProviderOptions,
  env: Record<string, string | undefined>,
  path: string
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, envName] of Object.entries(options.headersEnv ?? {})) {
    const value = env[envName];
    if (!value) {
      throw new ValidationError(
        `${envName} is not set (required for ${path}.headersEnv '${name}')`
      );
    }
    headers[name] = value;
  }
  return headers;
}

export function createAiClient(
  options: AiProviderOptions,
  env: Record<string, string | undefined>,
  fetch: FetchFn,
  path = "prOptions.ai"
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
    const apiKey = env[keyEnv];
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
  const apiKey = keyEnv === undefined ? undefined : env[keyEnv];
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
