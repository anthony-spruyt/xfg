export { SecretsProcessor } from "./processor.js";
export type {
  SecretsProcessorOptions,
  SecretsProcessorResult,
} from "./processor.js";
export type { SecretsConfig } from "../config/index.js";
export { GitHubSecretsStrategy } from "./github-secrets-strategy.js";
export { SodiumEncryptor, type ISecretEncryptor } from "./encryption.js";
export type {
  ISecretsStrategy,
  GitHubSecret,
  GitHubPublicKey,
} from "./types.js";
