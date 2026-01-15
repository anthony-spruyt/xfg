import { stringify } from "yaml";

export type OutputFormat = "json" | "yaml";

/**
 * Detects output format from file extension.
 */
export function detectOutputFormat(fileName: string): OutputFormat {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "yaml" || ext === "yml") {
    return "yaml";
  }
  return "json";
}

/**
 * Converts content object to string in the appropriate format.
 */
export function convertContentToString(
  content: Record<string, unknown>,
  fileName: string,
): string {
  const format = detectOutputFormat(fileName);

  if (format === "yaml") {
    return stringify(content, { indent: 2 });
  }

  return JSON.stringify(content, null, 2);
}
