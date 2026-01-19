import { Document, stringify } from "yaml";

export type OutputFormat = "json" | "json5" | "yaml";

/**
 * Options for content conversion.
 */
export interface ConvertOptions {
  header?: string[];
  schemaUrl?: string;
}

/**
 * Detects output format from file extension.
 */
export function detectOutputFormat(fileName: string): OutputFormat {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "yaml" || ext === "yml") {
    return "yaml";
  }
  if (ext === "json5") {
    return "json5";
  }
  return "json";
}

/**
 * Builds header comment string from header lines and schemaUrl.
 * Returns undefined if no comments to add.
 * Each line gets a space prefix since yaml library adds # directly.
 */
function buildHeaderComment(
  header?: string[],
  schemaUrl?: string,
): string | undefined {
  const lines: string[] = [];

  // Add yaml-language-server schema directive first (if present)
  if (schemaUrl) {
    lines.push(` yaml-language-server: $schema=${schemaUrl}`);
  }

  // Add custom header lines (with space prefix for proper formatting)
  if (header && header.length > 0) {
    lines.push(...header.map((h) => ` ${h}`));
  }

  if (lines.length === 0) return undefined;

  // Join with newlines - the yaml library adds # prefix to each line
  return lines.join("\n");
}

/**
 * Builds comment-only output for empty YAML files with headers.
 */
function buildCommentOnlyYaml(
  header?: string[],
  schemaUrl?: string,
): string | undefined {
  const lines: string[] = [];

  // Add yaml-language-server schema directive first (if present)
  if (schemaUrl) {
    lines.push(`# yaml-language-server: $schema=${schemaUrl}`);
  }

  // Add custom header lines
  if (header && header.length > 0) {
    lines.push(...header.map((h) => `# ${h}`));
  }

  if (lines.length === 0) return undefined;

  return lines.join("\n") + "\n";
}

/**
 * Converts content to string in the appropriate format.
 * Handles null content (empty files), text content (string/string[]), and object content (JSON/YAML).
 */
export function convertContentToString(
  content: Record<string, unknown> | string | string[] | null,
  fileName: string,
  options?: ConvertOptions,
): string {
  // Handle empty file case
  if (content === null) {
    const format = detectOutputFormat(fileName);
    if (format === "yaml" && options) {
      const commentOnly = buildCommentOnlyYaml(
        options.header,
        options.schemaUrl,
      );
      if (commentOnly) {
        return commentOnly;
      }
    }
    return "";
  }

  // Handle string content (text file)
  if (typeof content === "string") {
    // Ensure trailing newline for text files
    return content.endsWith("\n") ? content : content + "\n";
  }

  // Handle string[] content (text file with lines)
  if (Array.isArray(content)) {
    // Join lines with newlines and ensure trailing newline
    const text = content.join("\n");
    return text.length > 0 ? text + "\n" : "";
  }

  // Handle object content (JSON/YAML)
  const format = detectOutputFormat(fileName);

  if (format === "yaml") {
    // Use Document API for YAML to support comments
    const doc = new Document(content);

    // Add header comment if present
    if (options) {
      const headerComment = buildHeaderComment(
        options.header,
        options.schemaUrl,
      );
      if (headerComment) {
        doc.commentBefore = headerComment;
      }
    }

    // Quote all string values for YAML 1.1 compatibility.
    // The yaml library outputs YAML 1.2 where "06:00" is a plain string,
    // but many tools (e.g., Dependabot) use YAML 1.1 parsers that interpret
    // unquoted values like "06:00" as sexagesimal (360) or "yes"/"no" as booleans.
    return stringify(doc, {
      indent: 2,
      defaultStringType: "QUOTE_DOUBLE",
      defaultKeyType: "PLAIN",
    });
  }

  if (format === "json5") {
    // JSON5 format - output standard JSON (which is valid JSON5)
    // Using JSON.stringify for standard JSON output that's compatible everywhere
    return JSON.stringify(content, null, 2) + "\n";
  }

  // JSON format - comments not supported, ignore header/schemaUrl
  return JSON.stringify(content, null, 2) + "\n";
}
