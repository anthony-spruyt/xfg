import { ValidationError } from "../../shared/errors.js";
import { validateBranchName } from "../../shared/branch-validation.js";
import { arrayValues } from "../array-directive.js";
import type { PRMergeOptions } from "../types.js";
import { validateAiOption } from "./ai-validator.js";

/** Validates prOptions of one layer; `context` names the layer, empty for the root. */
export function validatePrOptions(
  prOptions: PRMergeOptions | undefined,
  context = ""
): void {
  if (prOptions === undefined) return;
  const prefix = context ? `${context}: ` : "";

  if (prOptions.branch !== undefined) {
    validateBranchName(prOptions.branch);
  }
  validateAiOption(prOptions.ai);

  if (prOptions.labels === undefined) return;

  const labels = arrayValues(prOptions.labels);
  if (labels === null) {
    throw new ValidationError(
      `${prefix}prOptions.labels must be an array of strings or $arrayMerge directive`
    );
  }
  for (const label of labels) {
    if (typeof label !== "string" || label.length === 0) {
      throw new ValidationError(
        `${prefix}prOptions.labels entries must be non-empty strings`
      );
    }
  }
}
