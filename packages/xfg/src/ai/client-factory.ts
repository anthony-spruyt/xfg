import { ValidationError } from "../shared/errors.js";
import {
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
import type { AiOptions, FetchFn, IAiClient } from "./types.js";

/** The default key env only applies to the provider's own API. */
function keyEnvFor(options: AiOptions): string | undefined {
  if (options.apiKeyEnv !== undefined) return options.apiKeyEnv;
  return isDefaultAiBaseUrl(options.provider, options.baseUrl)
    ? defaultAiKeyEnv(options.provider)
    : undefined;
}

export function createAiClient(
  options: AiOptions,
  env: Record<string, string | undefined>,
  fetch: FetchFn
): IAiClient {
  assertAiKeyEnvAllowed(options.provider, options.apiKeyEnv, options.baseUrl);
  const keyEnv = keyEnvFor(options);

  if (options.provider === "anthropic") {
    if (keyEnv === undefined) {
      throw new ValidationError(
        "prOptions.ai.apiKeyEnv is required for provider 'anthropic' with a custom baseUrl"
      );
    }
    const apiKey = env[keyEnv];
    if (!apiKey) {
      throw new ValidationError(
        `${keyEnv} is not set (required for prOptions.ai provider 'anthropic')`
      );
    }
    return new AnthropicClient({
      apiKey,
      model: options.model ?? DEFAULT_ANTHROPIC_MODEL,
      baseUrl: options.baseUrl,
      fetch,
    });
  }

  if (!options.model) {
    throw new ValidationError(
      "prOptions.ai.model is required when provider is 'openai'"
    );
  }
  const apiKey = keyEnv === undefined ? undefined : env[keyEnv];
  // A custom baseUrl (Ollama, local LiteLLM) often needs no key at all.
  if (!apiKey && !options.baseUrl) {
    throw new ValidationError(
      `${keyEnv} is not set (required for prOptions.ai provider 'openai' without baseUrl)`
    );
  }
  return new OpenAICompatibleClient({
    apiKey,
    model: options.model,
    baseUrl: options.baseUrl ?? DEFAULT_OPENAI_BASE_URL,
    fetch,
  });
}
