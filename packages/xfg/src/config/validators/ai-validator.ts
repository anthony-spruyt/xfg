import { isPlainObject } from "../../shared/type-guards.js";
import { ValidationError } from "../../shared/errors.js";
import type { AiProvider } from "../types.js";

const VALID_PROVIDERS: AiProvider[] = ["anthropic", "openai"];
const STRING_FIELDS = ["model", "baseUrl", "apiKeyEnv", "prompt"] as const;

export function validateAiOption(ai: unknown): void {
  if (ai === undefined || typeof ai === "boolean") return;
  if (!isPlainObject(ai)) {
    throw new ValidationError("prOptions.ai must be a boolean or an object");
  }

  const provider = ai.provider;
  if (
    provider !== undefined &&
    !VALID_PROVIDERS.includes(provider as AiProvider)
  ) {
    throw new ValidationError(
      `prOptions.ai.provider must be one of: ${VALID_PROVIDERS.join(", ")}`
    );
  }

  for (const field of STRING_FIELDS) {
    const value = ai[field];
    if (value !== undefined && (typeof value !== "string" || value === "")) {
      throw new ValidationError(
        `prOptions.ai.${field} must be a non-empty string`
      );
    }
  }

  if (provider === "openai" && ai.model === undefined) {
    throw new ValidationError(
      "prOptions.ai.model is required when provider is 'openai'"
    );
  }

  const max = ai.maxDiffChars;
  if (
    max !== undefined &&
    (typeof max !== "number" || !Number.isInteger(max) || max <= 0)
  ) {
    throw new ValidationError(
      "prOptions.ai.maxDiffChars must be a positive integer"
    );
  }
}
