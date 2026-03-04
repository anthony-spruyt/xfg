// Types
export type { ILabelsStrategy, GitHubLabel } from "./types.js";

// Converter
export { normalizeColor, labelConfigToPayload } from "./converter.js";

// Diff
export { diffLabels, type LabelChange, type LabelAction } from "./diff.js";

// Formatter
export {
  formatLabelsPlan,
  type LabelsPlanResult,
  type LabelsPlanEntry,
} from "./formatter.js";

// Processor
export {
  LabelsProcessor,
  type ILabelsProcessor,
  type LabelsProcessorOptions,
  type LabelsProcessorResult,
} from "./processor.js";

// Strategy
export { GitHubLabelsStrategy } from "./github-labels-strategy.js";
