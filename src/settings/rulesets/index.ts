// Diff algorithm - property-level diffing for ruleset comparisons
export {
  computePropertyDiffs,
  deepEqual,
  isObject,
  isArrayOfObjects,
  type DiffAction,
  type PropertyDiff,
} from "./diff-algorithm.js";

// Types
export { type IRulesetStrategy, type RulesetStrategyOptions } from "./types.js";

// Processor
export {
  RulesetProcessor,
  type IRulesetProcessor,
  type RulesetProcessorOptions,
  type RulesetProcessorResult,
} from "./processor.js";

// Strategy
export { GitHubRulesetStrategy } from "./github-ruleset-strategy.js";

// Diff
export { diffRulesets, formatDiff } from "./diff.js";

// Formatter
export { formatRulesetPlan, formatPropertyTree } from "./formatter.js";
