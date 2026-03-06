// Diff algorithm - property-level diffing for ruleset comparisons
export {
  computePropertyDiffs,
  deepEqual,
  isArrayOfObjects,
  type PropertyDiff,
} from "./diff-algorithm.js";

// Formatter
export { formatPropertyTree, type RulesetPlanEntry } from "./formatter.js";

// Processor
export { RulesetProcessor, type IRulesetProcessor } from "./processor.js";
