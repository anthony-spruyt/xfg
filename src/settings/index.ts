// Base processor
export { type ISettingsProcessor } from "./base-processor.js";

// Rulesets
export {
  type PropertyDiff,
  formatPropertyTree,
  type RulesetPlanEntry,
  RulesetProcessor,
  type IRulesetProcessor,
} from "./rulesets/index.js";

// Repo settings
export {
  RepoSettingsProcessor,
  type IRepoSettingsProcessor,
  type RepoSettingsPlanEntry,
} from "./repo-settings/index.js";

// Labels
export {
  type LabelsPlanEntry,
  LabelsProcessor,
  type ILabelsProcessor,
} from "./labels/index.js";
