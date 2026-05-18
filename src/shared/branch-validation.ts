import { ValidationError } from "./errors.js";

export function validateBranchName(branchName: string): void {
  if (!branchName || branchName.trim() === "") {
    throw new ValidationError("Branch name cannot be empty");
  }

  if (branchName.startsWith(".") || branchName.startsWith("-")) {
    throw new ValidationError('Branch name cannot start with "." or "-"');
  }

  // Git disallows: space, ~, ^, :, ?, *, [, \, and consecutive dots (..)
  if (/[\s~^:?*[\\]/.test(branchName) || branchName.includes("..")) {
    throw new ValidationError("Branch name contains invalid characters");
  }

  if (
    branchName.endsWith("/") ||
    branchName.endsWith(".lock") ||
    branchName.endsWith(".")
  ) {
    throw new ValidationError("Branch name has invalid ending");
  }
}
