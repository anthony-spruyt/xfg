/**
 * XFG template variable interpolation utilities.
 * Supports ${xfg:variable} syntax for repo-specific content.
 * Use $${xfg:variable} to escape and output literal ${xfg:variable}.
 */

import {
  interpolateString,
  interpolateValue,
  type InterpolationConfig,
} from "./interpolation-engine.js";

import { ValidationError } from "./errors.js";

type TemplateContent = Record<string, unknown> | string | string[];

export type RepoDisplayInfo =
  | {
      type: "github";
      gitUrl: string;
      repo: string;
      owner: string;
      host: string;
    }
  | {
      type: "azure-devops";
      gitUrl: string;
      repo: string;
      owner: string;
      organization: string;
      project: string;
    }
  | {
      type: "gitlab";
      gitUrl: string;
      repo: string;
      owner: string;
      namespace: string;
      host: string;
    };

export interface XfgTemplateContext {
  /** Repository information from URL parsing */
  repoInfo: RepoDisplayInfo;
  /** Current file being processed */
  fileName: string;
  /** Custom variables defined in config */
  vars?: Record<string, string>;
}

interface XfgInterpolationOptions {
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
 * Get the value of a built-in xfg variable.
 * Returns undefined if the variable is not recognized.
 */
function getBuiltinVariable(
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

function buildXfgConfig(
  ctx: XfgTemplateContext,
  options: XfgInterpolationOptions
): InterpolationConfig {
  function resolveXfgVar(match: string, varName: string): string {
    // First check custom vars
    if (ctx.vars && varName in ctx.vars) {
      return ctx.vars[varName];
    }

    // Then check built-in vars
    const builtinValue = getBuiltinVariable(varName, ctx);
    if (builtinValue !== undefined) {
      return builtinValue;
    }

    // Unknown variable
    if (options.strict) {
      throw new ValidationError(`Unknown xfg template variable: ${varName}`);
    }

    // Non-strict mode - leave placeholder as-is
    return match;
  }

  return {
    escapeRegex: ESCAPED_XFG_VAR_REGEX,
    escapePlaceholder: "\x00ESCAPED_XFG_VAR\x00",
    applyInterpolation: (value) => value.replace(XFG_VAR_REGEX, resolveXfgVar),
    restoreEscaped: (content) => `\${xfg:${content}}`,
  };
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
  content: string,
  ctx: XfgTemplateContext,
  options?: XfgInterpolationOptions
): string;
export function interpolateXfgContent(
  content: string[],
  ctx: XfgTemplateContext,
  options?: XfgInterpolationOptions
): string[];
export function interpolateXfgContent(
  content: Record<string, unknown>,
  ctx: XfgTemplateContext,
  options?: XfgInterpolationOptions
): Record<string, unknown>;
export function interpolateXfgContent(
  content: TemplateContent,
  ctx: XfgTemplateContext,
  options?: XfgInterpolationOptions
): TemplateContent;
export function interpolateXfgContent(
  content: TemplateContent,
  ctx: XfgTemplateContext,
  options: XfgInterpolationOptions = DEFAULT_OPTIONS
): TemplateContent {
  const config = buildXfgConfig(ctx, options);
  if (typeof content === "string") {
    return interpolateString(content, config);
  }

  if (Array.isArray(content)) {
    return content.map((line) => interpolateString(line, config));
  }

  return interpolateValue(content, config);
}
