import { ValidationError } from "./errors.js";
import { isPlainObject } from "./type-guards.js";

/** Credentials xfg itself reads; config must never route them anywhere else. */
export const CREDENTIAL_ENV_VARS: ReadonlySet<string> = new Set([
  "XFG_GITHUB_APP_PRIVATE_KEY",
  "XFG_GITHUB_CLIENT_ID",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "GITHUB_ENTERPRISE_TOKEN",
  "AZURE_DEVOPS_EXT_PAT",
  "GITLAB_TOKEN",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
]);

export function isCredentialEnvName(name: string): boolean {
  return CREDENTIAL_ENV_VARS.has(name.toUpperCase());
}

const AI_PROVIDER_DEFAULTS: Record<string, { keyEnv: string; origin: string }> =
  {
    anthropic: {
      keyEnv: "ANTHROPIC_API_KEY",
      origin: "https://api.anthropic.com",
    },
    openai: { keyEnv: "OPENAI_API_KEY", origin: "https://api.openai.com" },
  };

export function defaultAiKeyEnv(provider: string): string {
  return AI_PROVIDER_DEFAULTS[provider].keyEnv;
}

export function isDefaultAiBaseUrl(
  provider: string,
  baseUrl: string | undefined
): boolean {
  if (baseUrl === undefined) return true;
  try {
    return new URL(baseUrl).origin === AI_PROVIDER_DEFAULTS[provider].origin;
  } catch {
    return false;
  }
}

/**
 * A credential name may only feed `prOptions.ai` when it is the provider's
 * own key going to the provider's own API.
 */
export function assertAiKeyEnvAllowed(
  provider: string,
  apiKeyEnv: string | undefined,
  baseUrl: string | undefined,
  path = "prOptions.ai"
): void {
  if (apiKeyEnv === undefined || !isCredentialEnvName(apiKeyEnv)) return;
  const ownKey = apiKeyEnv.toUpperCase() === defaultAiKeyEnv(provider);
  if (ownKey && isDefaultAiBaseUrl(provider, baseUrl)) return;
  throw new ValidationError(
    `${path}.apiKeyEnv '${apiKeyEnv}' is a credential xfg uses elsewhere; ` +
      `export the key under a dedicated name for this provider and baseUrl.`
  );
}

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_AI_HEADERS: ReadonlySet<string> = new Set([
  "authorization",
  "x-api-key",
  "anthropic-version",
  "content-type",
  "content-length",
  "host",
]);

/**
 * `headersEnv` maps header names to env var names. A value is never accepted
 * inline, and the env var may not be a credential xfg uses elsewhere.
 */
export function assertAiHeadersEnvAllowed(
  headersEnv: unknown,
  path = "prOptions.ai"
): void {
  if (headersEnv === undefined) return;
  if (!isPlainObject(headersEnv)) {
    throw new ValidationError(
      `${path}.headersEnv must be an object of header name to env var name`
    );
  }
  const seen = new Set<string>();
  for (const [name, envName] of Object.entries(headersEnv)) {
    if (!HEADER_NAME.test(name)) {
      throw new ValidationError(
        `${path}.headersEnv key '${name}' is not a valid HTTP header name`
      );
    }
    const lower = name.toLowerCase();
    if (RESERVED_AI_HEADERS.has(lower)) {
      throw new ValidationError(
        `${path}.headersEnv header '${name}' is reserved; xfg sets it itself`
      );
    }
    if (seen.has(lower)) {
      throw new ValidationError(
        `${path}.headersEnv names header '${name}' more than once`
      );
    }
    seen.add(lower);
    if (typeof envName !== "string" || !ENV_NAME.test(envName)) {
      throw new ValidationError(
        `${path}.headersEnv['${name}'] must be an env var name, not a value`
      );
    }
    if (isCredentialEnvName(envName)) {
      throw new ValidationError(
        `${path}.headersEnv['${name}'] '${envName}' is a credential xfg uses elsewhere; ` +
          `export the value under a dedicated name for this header.`
      );
    }
  }
}
