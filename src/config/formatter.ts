import { Document, isScalar, Scalar, stringify, visit } from "yaml";

type OutputFormat = "json" | "json5" | "yaml";

interface ConvertOptions {
  header?: string[];
  schemaUrl?: string;
}

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
  schemaUrl?: string
): string | undefined {
  const lines: string[] = [];

  if (schemaUrl) {
    lines.push(` yaml-language-server: $schema=${schemaUrl}`);
  }

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
  schemaUrl?: string
): string | undefined {
  const lines: string[] = [];

  if (schemaUrl) {
    lines.push(`# yaml-language-server: $schema=${schemaUrl}`);
  }

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
  options?: ConvertOptions
): string {
  if (content === null) {
    const format = detectOutputFormat(fileName);
    if (format === "yaml" && options) {
      const commentOnly = buildCommentOnlyYaml(
        options.header,
        options.schemaUrl
      );
      if (commentOnly) {
        return commentOnly;
      }
    }
    return "";
  }

  if (typeof content === "string") {
    return content.endsWith("\n") ? content : content + "\n";
  }

  if (Array.isArray(content)) {
    const text = content.join("\n");
    return text.length > 0 ? text + "\n" : "";
  }

  const format = detectOutputFormat(fileName);

  if (format === "yaml") {
    // Use Document API for YAML to support comments
    const doc = new Document(content);

    // Add header comment if present
    if (options) {
      const headerComment = buildHeaderComment(
        options.header,
        options.schemaUrl
      );
      if (headerComment) {
        doc.commentBefore = headerComment;
      }
    }

    // Use BLOCK_LITERAL (|) for multi-line string values to preserve readability.
    // Single-line strings remain QUOTE_DOUBLE via defaultStringType for YAML 1.1
    // compatibility (prevents "06:00" as sexagesimal, "yes"/"no" as booleans).
    visit(doc, {
      Scalar(key, node) {
        if (
          key === "value" &&
          isScalar(node) &&
          typeof node.value === "string" &&
          node.value.includes("\n")
        ) {
          node.type = Scalar.BLOCK_LITERAL;
        }
      },
    });

    return stringify(doc, {
      indent: 2,
      defaultStringType: "QUOTE_DOUBLE",
      defaultKeyType: "PLAIN",
    });
  }

  // JSON and JSON5 — both use standard JSON.stringify (valid JSON5 superset)
  return JSON.stringify(content, null, 2) + "\n";
}
