import { ValidationError } from "../shared/errors.js";
import {
  AnthropicClient,
  DEFAULT_ANTHROPIC_MODEL,
} from "./anthropic-client.js";
import {
  DEFAULT_OPENAI_BASE_URL,
  OpenAICompatibleClient,
} from "./openai-compatible-client.js";
import type { AiOptions, FetchFn, IAiClient } from "./types.js";

export function createAiClient(
  options: AiOptions,
  env: Record<string, string | undefined>,
  fetch: FetchFn
): IAiClient {
  if (options.provider === "anthropic") {
    const keyEnv = options.apiKeyEnv ?? "ANTHROPIC_API_KEY";
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
  const keyEnv = options.apiKeyEnv ?? "OPENAI_API_KEY";
  const apiKey = env[keyEnv];
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
