import type {
  IRepoSettingsStrategy,
  RepoSettingsStrategyOptions,
  CurrentRepoSettings,
} from "./types.js";
import { isRepoSettingsStrategy } from "./types.js";

// Re-export for backwards compatibility
export type {
  IRepoSettingsStrategy,
  RepoSettingsStrategyOptions,
  CurrentRepoSettings,
};
export { isRepoSettingsStrategy };
