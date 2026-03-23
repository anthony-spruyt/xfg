// Diff algorithm - property-level diffing for ruleset comparisons
export {
  computePropertyDiffs,
  deepEqual,
  isArrayOfObjects,
  type PropertyDiff,
} from "./diff-algorithm.js";

// Formatter
export { type RulesetPlanEntry } from "./formatter.js";

// Processor
export { RulesetProcessor, type IRulesetProcessor } from "./processor.js";

// Strategy
export { GitHubRulesetStrategy } from "./github-ruleset-strategy.js";
