import { ValidationError } from "./errors.js";

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
  baseUrl: string | undefined
): void {
  if (apiKeyEnv === undefined || !isCredentialEnvName(apiKeyEnv)) return;
  const ownKey = apiKeyEnv.toUpperCase() === defaultAiKeyEnv(provider);
  if (ownKey && isDefaultAiBaseUrl(provider, baseUrl)) return;
  throw new ValidationError(
    `prOptions.ai.apiKeyEnv '${apiKeyEnv}' is a credential xfg uses elsewhere; ` +
      `export the key under a dedicated name for this provider and baseUrl.`
  );
}
