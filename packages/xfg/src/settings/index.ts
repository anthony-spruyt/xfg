export {
  type BaseProcessorResult,
  type ISettingsProcessor,
  type SettingsAction,
  type ActiveAction,
  countActions,
  isActiveAction,
} from "./base-processor.js";

export {
  type PropertyDiff,
  type RulesetPlanEntry,
  RulesetProcessor,
  type IRulesetProcessor,
  GitHubRulesetStrategy,
} from "./rulesets/index.js";

export {
  RepoSettingsProcessor,
  type IRepoSettingsProcessor,
  type RepoSettingsPlanEntry,
  GitHubRepoSettingsStrategy,
} from "./repo-settings/index.js";

export {
  type LabelsPlanEntry,
  LabelsProcessor,
  type ILabelsProcessor,
  GitHubLabelsStrategy,
} from "./labels/index.js";

export {
  type CodeScanningPlanEntry,
  CodeScanningProcessor,
  type ICodeScanningProcessor,
  GitHubCodeScanningStrategy,
} from "./code-scanning/index.js";

export {
  type VariablesPlanEntry,
  VariablesProcessor,
  type IVariablesProcessor,
  GitHubVariablesStrategy,
} from "./variables/index.js";

// Secrets — not wired into `xfg sync`; driven by `xfg secrets sync` only.
export {
  SecretsProcessor,
  type SecretsPlanEntry,
  type ISecretsProcessor,
  type SecretsProcessorOptions,
  type SecretsProcessorResult,
  GitHubSecretsStrategy,
  SodiumEncryptor,
  type ISecretEncryptor,
} from "./secrets/index.js";
