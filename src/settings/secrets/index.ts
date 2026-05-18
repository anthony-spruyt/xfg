export { diffSecrets, type SecretChange, type SecretAction } from "./diff.js";
export { SecretsProcessor } from "./processor.js";
export type {
  ISecretsProcessor,
  SecretsProcessorOptions,
  SecretsProcessorResult,
} from "./processor.js";
export type { SecretsConfig } from "../../config/index.js";
export { GitHubSecretsStrategy } from "./github-secrets-strategy.js";
export { SodiumEncryptor, type ISecretEncryptor } from "./encryption.js";
export type {
  ISecretsStrategy,
  UpsertSecretParams,
  GitHubSecret,
  GitHubPublicKey,
} from "./types.js";
