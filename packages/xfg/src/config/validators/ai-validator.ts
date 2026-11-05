import { isPlainObject } from "../../shared/type-guards.js";
import { ValidationError } from "../../shared/errors.js";
import {
  assertAiBaseUrlEnvAllowed,
  assertAiHeadersEnvAllowed,
  assertAiKeyEnvAllowed,
} from "../../shared/credential-env.js";
import type { AiProvider } from "../types.js";
import { assertNoRootInherit } from "./inherit-flag.js";

const VALID_PROVIDERS: AiProvider[] = ["anthropic", "openai"];
const STRING_FIELDS = ["model", "baseUrl", "apiKeyEnv", "prompt"] as const;
const PROVIDER_KEYS = [
  "provider",
  "maxDiffChars",
  "headersEnv",
  "baseUrlEnv",
  ...STRING_FIELDS,
];
const PRIMARY_KEYS = new Set<string>([...PROVIDER_KEYS, "fallback", "inherit"]);
const FALLBACK_KEYS = new Set<string>(PROVIDER_KEYS);

/** `context` names the layer or repo, empty for the root; `inherit` is only valid in a layer. */
export function validateAiOption(ai: unknown, context = ""): void {
  if (ai === undefined || typeof ai === "boolean") return;
  const path = context ? `${context}: prOptions.ai` : "prOptions.ai";
  if (!isPlainObject(ai)) {
    throw new ValidationError(`${path} must be a boolean or an object`);
  }

  if (!context) assertNoRootInherit(ai, "prOptions.ai");
  if (ai.inherit !== undefined && typeof ai.inherit !== "boolean") {
    throw new ValidationError(`${path}.inherit must be a boolean`);
  }
  validateProvider(ai, path, PRIMARY_KEYS);

  if (ai.fallback !== undefined) {
    if (!isPlainObject(ai.fallback)) {
      throw new ValidationError(`${path}.fallback must be an object`);
    }
    validateProvider(ai.fallback, `${path}.fallback`, FALLBACK_KEYS);
  }
}

function validateProvider(
  ai: Record<string, unknown>,
  path: string,
  knownKeys: Set<string>
): void {
  const unknown = Object.keys(ai).find((key) => !knownKeys.has(key));
  if (unknown !== undefined) {
    throw new ValidationError(`${path} has unknown key '${unknown}'`);
  }

  const provider = ai.provider;
  if (
    provider !== undefined &&
    !VALID_PROVIDERS.includes(provider as AiProvider)
  ) {
    throw new ValidationError(
      `${path}.provider must be one of: ${VALID_PROVIDERS.join(", ")}`
    );
  }

  for (const field of STRING_FIELDS) {
    const value = ai[field];
    if (value !== undefined && (typeof value !== "string" || value === "")) {
      throw new ValidationError(`${path}.${field} must be a non-empty string`);
    }
  }

  assertAiBaseUrlEnvAllowed(ai.baseUrlEnv, ai.baseUrl, path);
  assertAiKeyEnvAllowed(
    (provider as AiProvider | undefined) ?? "anthropic",
    ai.apiKeyEnv as string | undefined,
    ai.baseUrl as string | undefined,
    path,
    // A URL read from the env is unknown here, so it never counts as the provider's own API.
    ai.baseUrlEnv !== undefined
  );
  assertAiHeadersEnvAllowed(ai.headersEnv, path);

  if (provider === "openai" && ai.model === undefined) {
    throw new ValidationError(
      `${path}.model is required when provider is 'openai'`
    );
  }

  const max = ai.maxDiffChars;
  if (
    max !== undefined &&
    (typeof max !== "number" || !Number.isInteger(max) || max <= 0)
  ) {
    throw new ValidationError(
      `${path}.maxDiffChars must be a positive integer`
    );
  }
}
