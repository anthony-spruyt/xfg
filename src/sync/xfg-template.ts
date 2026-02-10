/**
 * XFG template variable interpolation utilities.
 * Supports ${xfg:variable} syntax for repo-specific content.
 * Use $${xfg:variable} to escape and output literal ${xfg:variable}.
 */

import type { RepoInfo } from "../shared/repo-detector.js";
import type { ContentValue } from "../config/index.js";

export interface XfgTemplateContext {
  /** Repository information from URL parsing */
  repoInfo: RepoInfo;
  /** Current file being processed */
  fileName: string;
  /** Custom variables defined in config */
  vars?: Record<string, string>;
}

export interface XfgInterpolationOptions {
  /**
   * If true (default), throws an error when a variable is missing.
   * If false, leaves the placeholder as-is.
   */
  strict: boolean;
}

const DEFAULT_OPTIONS: XfgInterpolationOptions = {
  strict: true,
};

/**
 * Regex to match xfg template variable placeholders.
 * Captures the variable name including dot notation.
 * Variable names can only contain: a-z, A-Z, 0-9, dots, and underscores.
 *
 * Examples:
 * - ${xfg:repo.name} -> varName=repo.name
 * - ${xfg:myVar} -> varName=myVar
 */
const XFG_VAR_REGEX = /\$\{xfg:([a-zA-Z0-9._]+)\}/g;

/**
 * Regex to match escaped xfg template variable placeholders.
 * $${xfg:...} outputs literal ${xfg:...} without interpolation.
 * Variable names can only contain: a-z, A-Z, 0-9, dots, and underscores.
 */
const ESCAPED_XFG_VAR_REGEX = /\$\$\{xfg:([a-zA-Z0-9._]+)\}/g;

/**
 * Placeholder prefix for temporarily storing escaped sequences.
 * Uses null bytes which won't appear in normal content.
 */
const ESCAPE_PLACEHOLDER = "\x00ESCAPED_XFG_VAR\x00";

/**
 * Get the value of a built-in xfg variable.
 * Returns undefined if the variable is not recognized.
 */
function getBuiltinVar(
  varName: string,
  ctx: XfgTemplateContext
): string | undefined {
  const { repoInfo, fileName } = ctx;

  switch (varName) {
    case "repo.name":
      return repoInfo.repo;

    case "repo.owner":
      return repoInfo.owner;

    case "repo.fullName":
      if (repoInfo.type === "azure-devops") {
        return `${repoInfo.organization}/${repoInfo.project}/${repoInfo.repo}`;
      }
      if (repoInfo.type === "gitlab") {
        return `${repoInfo.namespace}/${repoInfo.repo}`;
      }
      return `${repoInfo.owner}/${repoInfo.repo}`;

    case "repo.url":
      return repoInfo.gitUrl;

    case "repo.platform":
      return repoInfo.type;

    case "repo.host":
      if (repoInfo.type === "github" || repoInfo.type === "gitlab") {
        return repoInfo.host;
      }
      // Azure DevOps doesn't have a host field, use dev.azure.com
      return "dev.azure.com";

    case "file.name":
      return fileName;

    case "date":
      return new Date().toISOString().split("T")[0];

    default:
      return undefined;
  }
}

/**
 * Check if a value is a plain object (not null, not array).
 */
function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

/**
 * Process a single string value, replacing xfg template variable placeholders.
 * Supports escaping with $${xfg:var} syntax to output literal ${xfg:var}.
 */
function processString(
  value: string,
  ctx: XfgTemplateContext,
  options: XfgInterpolationOptions
): string {
  // Phase 1: Replace escaped $${xfg:...} with placeholders
  const escapedContent: string[] = [];
  let processed = value.replace(
    ESCAPED_XFG_VAR_REGEX,
    (_match, content: string) => {
      const index = escapedContent.length;
      escapedContent.push(content);
      return `${ESCAPE_PLACEHOLDER}${index}\x00`;
    }
  );

  // Phase 2: Interpolate remaining ${xfg:...}
  processed = processed.replace(XFG_VAR_REGEX, (match, varName: string) => {
    // First check custom vars
    if (ctx.vars && varName in ctx.vars) {
      return ctx.vars[varName];
    }

    // Then check built-in vars
    const builtinValue = getBuiltinVar(varName, ctx);
    if (builtinValue !== undefined) {
      return builtinValue;
    }

    // Unknown variable
    if (options.strict) {
      throw new Error(`Unknown xfg template variable: ${varName}`);
    }

    // Non-strict mode - leave placeholder as-is
    return match;
  });

  // Phase 3: Restore escaped sequences as literal ${xfg:...}
  processed = processed.replace(
    new RegExp(`${ESCAPE_PLACEHOLDER}(\\d+)\x00`, "g"),
    (_match, indexStr: string) => {
      const index = parseInt(indexStr, 10);
      return `\${xfg:${escapedContent[index]}}`;
    }
  );

  return processed;
}

/**
 * Recursively process a value, interpolating xfg template variables in strings.
 */
function processValue(
  value: unknown,
  ctx: XfgTemplateContext,
  options: XfgInterpolationOptions
): unknown {
  if (typeof value === "string") {
    return processString(value, ctx, options);
  }

  if (Array.isArray(value)) {
    return value.map((item) => processValue(item, ctx, options));
  }

  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = processValue(val, ctx, options);
    }
    return result;
  }

  // For numbers, booleans, null - return as-is
  return value;
}

/**
 * Interpolate xfg template variables in content.
 *
 * Supports these syntaxes:
 * - ${xfg:repo.name} - Repository name
 * - ${xfg:repo.owner} - Repository owner
 * - ${xfg:repo.fullName} - Full repository name (owner/repo)
 * - ${xfg:repo.url} - Git URL
 * - ${xfg:repo.platform} - Platform type (github, azure-devops, gitlab)
 * - ${xfg:repo.host} - Host domain
 * - ${xfg:file.name} - Current file name
 * - ${xfg:date} - Current date (YYYY-MM-DD)
 * - ${xfg:customVar} - Custom variable from vars config
 * - $${xfg:var} - Escape: outputs literal ${xfg:var}
 *
 * @param content - The content to process (object, string, or string[])
 * @param ctx - Template context with repo info and custom vars
 * @param options - Interpolation options (default: strict mode)
 * @returns Content with interpolated values
 */
export function interpolateXfgContent(
  content: ContentValue,
  ctx: XfgTemplateContext,
  options: XfgInterpolationOptions = DEFAULT_OPTIONS
): ContentValue {
  if (typeof content === "string") {
    return processString(content, ctx, options);
  }

  if (Array.isArray(content)) {
    return content.map((line) => processString(line, ctx, options));
  }

  return processValue(content, ctx, options) as Record<string, unknown>;
}
