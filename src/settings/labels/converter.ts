import type { Label } from "../../config/types.js";

interface GitHubLabelPayload {
  name: string;
  new_name?: string;
  color: string;
  description?: string;
}

/**
 * Strips '#' prefix and lowercases hex color.
 */
export function normalizeColor(color: string): string {
  return color.replace(/^#/, "").toLowerCase();
}

/**
 * Converts a label config entry to a GitHub API payload.
 */
export function labelConfigToPayload(
  name: string,
  label: Label
): GitHubLabelPayload {
  const payload: GitHubLabelPayload = {
    name,
    color: normalizeColor(label.color),
  };
  if (label.new_name !== undefined) {
    payload.new_name = label.new_name;
  }
  if (label.description !== undefined) {
    payload.description = label.description;
  }
  return payload;
}
