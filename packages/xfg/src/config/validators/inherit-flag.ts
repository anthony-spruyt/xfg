import { ValidationError } from "../../shared/errors.js";
import { isPlainObject } from "../../shared/type-guards.js";

export function validateInheritFlag(
  block: Record<string, unknown>,
  context: string
): void {
  if (block.inherit !== undefined && typeof block.inherit !== "boolean") {
    throw new ValidationError(`${context}: inherit must be a boolean`);
  }
}

/** Root blocks have nothing to inherit from, so `inherit` there is a mistake. */
export function assertNoRootInherit(
  block: unknown,
  name: string,
  context = ""
): void {
  if (!isPlainObject(block) || !("inherit" in block)) return;
  const prefix = context ? `${context}: ` : "";
  throw new ValidationError(
    `${prefix}'inherit' is not allowed in root-level ${name} (nothing to inherit from)`
  );
}
