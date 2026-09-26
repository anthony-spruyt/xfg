export { SecretsProcessor } from "./processor.js";
export type {
  ISecretsProcessor,
  SecretsProcessorOptions,
  SecretsProcessorResult,
} from "./processor.js";
export {
  formatSecretsPlan,
  type SecretsPlanEntry,
  type SecretsPlanResult,
} from "./formatter.js";
export { diffSecrets, type SecretAction, type SecretChange } from "./diff.js";
export { GitHubSecretsStrategy } from "./github-secrets-strategy.js";
export { SodiumEncryptor, type ISecretEncryptor } from "./encryption.js";
export type {
  ISecretsStrategy,
  GitHubSecret,
  GitHubPublicKey,
} from "./types.js";
