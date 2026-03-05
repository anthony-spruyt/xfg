export function sanitizeBranchName(fileName: string): string {
  return fileName
    .toLowerCase()
    .replace(/\.[^.]+$/, "") // Remove extension
    .replace(/[^a-z0-9-]/g, "-") // Replace non-alphanumeric with dashes
    .replace(/-+/g, "-") // Collapse multiple dashes
    .replace(/^-|-$/g, ""); // Remove leading/trailing dashes
}

/**
 * Validates a user-provided branch name against git's naming rules.
 * @throws Error if the branch name is invalid
 */
export function validateBranchName(branchName: string): void {
  if (!branchName || branchName.trim() === "") {
    throw new Error("Branch name cannot be empty");
  }

  if (branchName.startsWith(".") || branchName.startsWith("-")) {
    throw new Error('Branch name cannot start with "." or "-"');
  }

  // Git disallows: space, ~, ^, :, ?, *, [, \, and consecutive dots (..)
  if (/[\s~^:?*[\\]/.test(branchName) || branchName.includes("..")) {
    throw new Error("Branch name contains invalid characters");
  }

  if (
    branchName.endsWith("/") ||
    branchName.endsWith(".lock") ||
    branchName.endsWith(".")
  ) {
    throw new Error("Branch name has invalid ending");
  }
}
