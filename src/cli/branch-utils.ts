export { validateBranchName } from "../shared/branch-validation.js";

export function sanitizeBranchName(fileName: string): string {
  return fileName
    .toLowerCase()
    .replace(/\.[^.]+$/, "") // Remove extension
    .replace(/[^a-z0-9-]/g, "-") // Replace non-alphanumeric with dashes
    .replace(/-+/g, "-") // Collapse multiple dashes
    .replace(/^-|-$/g, ""); // Remove leading/trailing dashes
}
