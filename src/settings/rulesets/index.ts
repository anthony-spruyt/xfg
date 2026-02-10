// Diff algorithm - property-level diffing for ruleset comparisons
export {
  computePropertyDiffs,
  diffObjectArrays,
  deepEqual,
  isObject,
  isArrayOfObjects,
  type DiffAction,
  type PropertyDiff,
} from "./diff-algorithm.js";

// Ruleset processor
export {
  RulesetProcessor,
  type IRulesetProcessor,
  type RulesetProcessorOptions,
  type RulesetProcessorResult,
} from "./processor.js";

// Ruleset diff
export {
  diffRulesets,
  normalizeRuleset,
  projectToDesiredShape,
  type RulesetAction,
  type RulesetChange,
} from "./diff.js";

// Ruleset formatter
export {
  formatRulesetPlan,
  type RulesetPlanResult,
  type RulesetPlanEntry,
} from "./formatter.js";
