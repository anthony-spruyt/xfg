import { ValidationError } from "../../shared/errors.js";

export function validateInheritFlag(
  block: Record<string, unknown>,
  context: string
): void {
  if (block.inherit !== undefined && typeof block.inherit !== "boolean") {
    throw new ValidationError(`${context}: inherit must be a boolean`);
  }
}
