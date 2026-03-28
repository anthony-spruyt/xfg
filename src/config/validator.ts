import type {
  RawConfig,
  RawRepoSettings,
  RawRootSettings,
  RawGroupConfig,
} from "./types.js";
import { resolveExtendsChain, expandRepoGroups } from "./extends-resolver.js";
import {
  isTextContent,
  isObjectContent,
  isStructuredFileExtension,
  validateFileName,
  VALID_STRATEGIES,
} from "./validators/file-validator.js";
import { validateRepoSettings } from "./validators/repo-settings-validator.js";
import { validateRuleset } from "./validators/ruleset-validator.js";
import { escapeRegExp } from "../shared/shell-utils.js";
import { isPlainObject } from "../shared/type-guards.js";
import { ValidationError } from "../shared/errors.js";

// Pattern for valid config ID: alphanumeric, hyphens, underscores
const CONFIG_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const CONFIG_ID_MAX_LENGTH = 64;

/**
 * Check if a string looks like a valid git URL.
 * Supports SSH (git@host:path) and HTTPS (https://host/path) formats.
 */
function isValidGitUrl(url: string): boolean {
  // SSH format: git@hostname:path  OR  HTTPS format: https://hostname/path
  return /^git@[^:]+:.+$/.test(url) || /^https?:\/\/[^/]+\/.+$/.test(url);
}

/**
 * Check if a git URL points to GitHub (github.com).
 * Used to reject GitHub URLs as migration sources (not supported).
 */
function isGitHubUrl(url: string, githubHosts?: string[]): boolean {
  const hosts = ["github.com", ...(githubHosts ?? [])];
  for (const host of hosts) {
    if (
      url.startsWith(`git@${host}:`) ||
      url.match(new RegExp(`^https?://${escapeRegExp(host)}/`))
    ) {
      return true;
    }
  }
  return false;
}

function getGitDisplayName(git: string | string[]): string {
  if (Array.isArray(git)) {
    return git[0] || "unknown";
  }
  return git;
}

/**
 * Validate file config fields shared between root files and per-repo overrides.
 */
function validateFileConfigFields(
  fileConfig: Record<string, unknown>,
  fileName: string,
  context: string
): void {
  if (fileConfig.content !== undefined) {
    const hasText = isTextContent(fileConfig.content);
    const hasObject = isObjectContent(fileConfig.content);

    if (!hasText && !hasObject) {
      throw new ValidationError(
        `${context} file '${fileName}' content must be an object, string, or array of strings`
      );
    }

    const isStructured = isStructuredFileExtension(fileName);
    if (isStructured && hasText) {
      throw new ValidationError(
        `${context} file '${fileName}' has JSON/YAML extension but string content. Use object content for structured files.`
      );
    }
    if (!isStructured && hasObject) {
      throw new ValidationError(
        `${context} file '${fileName}' has text extension but object content. Use string or string[] for text files, or use .json/.yaml/.yml extension.`
      );
    }
  }

  if (
    fileConfig.mergeStrategy !== undefined &&
    !VALID_STRATEGIES.includes(fileConfig.mergeStrategy as string)
  ) {
    throw new ValidationError(
      `${context} file '${fileName}' has invalid mergeStrategy: ${fileConfig.mergeStrategy}. Must be one of: ${VALID_STRATEGIES.join(", ")}`
    );
  }

  const booleanFields = [
    "createOnly",
    "executable",
    "template",
    "deleteOrphaned",
  ] as const;
  for (const field of booleanFields) {
    if (
      fileConfig[field] !== undefined &&
      typeof fileConfig[field] !== "boolean"
    ) {
      throw new ValidationError(
        `${context} file '${fileName}' ${field} must be a boolean`
      );
    }
  }

  const stringFields = ["schemaUrl"] as const;
  for (const field of stringFields) {
    if (
      fileConfig[field] !== undefined &&
      typeof fileConfig[field] !== "string"
    ) {
      throw new ValidationError(
        `${context} file '${fileName}' ${field} must be a string`
      );
    }
  }

  if (fileConfig.header !== undefined) {
    if (
      typeof fileConfig.header !== "string" &&
      (!Array.isArray(fileConfig.header) ||
        !(fileConfig.header as unknown[]).every((h) => typeof h === "string"))
    ) {
      throw new ValidationError(
        `${context} file '${fileName}' header must be a string or array of strings`
      );
    }
  }

  if (fileConfig.vars !== undefined) {
    if (!isPlainObject(fileConfig.vars)) {
      throw new ValidationError(
        `${context} file '${fileName}' vars must be an object with string values`
      );
    }
    for (const [key, value] of Object.entries(
      fileConfig.vars as Record<string, unknown>
    )) {
      if (typeof value !== "string") {
        throw new ValidationError(
          `${context} file '${fileName}' vars.${key} must be a string`
        );
      }
    }
  }
}

/**
 * Validates a single label configuration.
 */
function validateLabel(label: unknown, name: string, context: string): void {
  if (!isPlainObject(label)) {
    throw new ValidationError(`${context}: label '${name}' must be an object`);
  }
  const l = label;
  if (typeof l.color !== "string" || !/^#?[0-9a-fA-F]{6}$/.test(l.color)) {
    throw new ValidationError(
      `${context}: label '${name}' color must be a 6-character hex code (with or without #)`
    );
  }
  if (l.description !== undefined) {
    if (typeof l.description !== "string") {
      throw new ValidationError(
        `${context}: label '${name}' description must be a string`
      );
    }
    if (l.description.length > 100) {
      throw new ValidationError(
        `${context}: label '${name}' description exceeds 100 characters (GitHub limit)`
      );
    }
  }
  if (l.new_name !== undefined && typeof l.new_name !== "string") {
    throw new ValidationError(
      `${context}: label '${name}' new_name must be a string`
    );
  }
}

interface RootSettingsContext {
  rulesetNames: string[];
  hasRepoSettings: boolean;
  hasCodeScanningSettings: boolean;
  labelNames: string[];
}

function buildRootSettingsContext(config: RawConfig): RootSettingsContext {
  return {
    rulesetNames: config.settings?.rulesets
      ? Object.keys(config.settings.rulesets).filter((k) => k !== "inherit")
      : [],
    hasRepoSettings:
      config.settings?.repo !== undefined && config.settings.repo !== false,
    hasCodeScanningSettings:
      config.settings?.codeScanning !== undefined &&
      config.settings.codeScanning !== false,
    labelNames: config.settings?.labels
      ? Object.keys(config.settings.labels).filter((k) => k !== "inherit")
      : [],
  };
}

/**
 * Validates settings object containing rulesets, labels, and repo settings.
 */
function validateSettings(
  settings: unknown,
  context: string,
  rootCtx?: RootSettingsContext
): void {
  if (!isPlainObject(settings)) {
    throw new ValidationError(`${context}: settings must be an object`);
  }

  if (settings.rulesets !== undefined) {
    if (!isPlainObject(settings.rulesets)) {
      throw new ValidationError(`${context}: rulesets must be an object`);
    }

    const rulesets = settings.rulesets;
    for (const [name, ruleset] of Object.entries(rulesets)) {
      // Skip reserved key
      if (name === "inherit") continue;

      if (ruleset === false) {
        if (rootCtx && !rootCtx.rulesetNames.includes(name)) {
          throw new ValidationError(
            `${context}: Cannot opt out of '${name}' - not defined in root settings.rulesets`
          );
        }
        continue; // Skip further validation for false entries
      }

      validateRuleset(ruleset, name, context);
    }
  }

  if (settings.labels !== undefined) {
    if (!isPlainObject(settings.labels)) {
      throw new ValidationError(`${context}: labels must be an object`);
    }
    const labels = settings.labels;
    for (const [name, label] of Object.entries(labels)) {
      if (name === "inherit") continue;
      if (label === false) {
        if (rootCtx && !rootCtx.labelNames.includes(name)) {
          throw new ValidationError(
            `${context}: Cannot opt out of label '${name}' - not defined in root settings.labels`
          );
        }
        continue;
      }
      validateLabel(label, name, context);
    }
  }

  if (
    settings.deleteOrphaned !== undefined &&
    typeof settings.deleteOrphaned !== "boolean"
  ) {
    throw new ValidationError(
      `${context}: settings.deleteOrphaned must be a boolean`
    );
  }

  if (settings.repo !== undefined) {
    if (settings.repo === false) {
      if (!rootCtx) {
        // Root level — repo: false not valid here
        throw new ValidationError(
          `${context}: repo: false is not valid at root level. Define repo settings or remove the field.`
        );
      }
      // Per-repo level — check root has repo settings to opt out of
      if (!rootCtx.hasRepoSettings) {
        throw new ValidationError(
          `${context}: Cannot opt out of repo settings — not defined in root settings.repo`
        );
      }
      // Valid opt-out, skip further repo validation
    } else {
      validateRepoSettings(settings.repo, context);
    }
  }

  if (settings.codeScanning !== undefined) {
    if (settings.codeScanning === false) {
      if (!rootCtx) {
        throw new ValidationError(
          `${context}: codeScanning: false is not valid at root level. Define codeScanning settings or remove the field.`
        );
      }
      // Per-repo level — check root has codeScanning settings to opt out of
      if (!rootCtx.hasCodeScanningSettings) {
        throw new ValidationError(
          `${context}: Cannot opt out of code scanning settings — not defined in root settings.codeScanning`
        );
      }
    } else {
      validateCodeScanningSettings(
        settings.codeScanning,
        `${context} codeScanning`
      );
    }
  }
}

const VALID_CODE_SCANNING_STATES = ["configured", "not-configured"];
const VALID_CODE_SCANNING_QUERY_SUITES = ["default", "extended"];
const VALID_CODE_SCANNING_LANGUAGES = [
  "actions",
  "c-cpp",
  "csharp",
  "go",
  "java-kotlin",
  "javascript-typescript",
  "python",
  "ruby",
  "swift",
];

function validateCodeScanningSettings(
  settings: unknown,
  context: string
): void {
  if (!isPlainObject(settings)) {
    throw new ValidationError(`${context}: must be an object`);
  }

  if (settings.state === undefined) {
    throw new ValidationError(`${context}: state is required`);
  }

  if (!VALID_CODE_SCANNING_STATES.includes(settings.state as string)) {
    throw new ValidationError(
      `${context}: state must be one of: ${VALID_CODE_SCANNING_STATES.join(", ")}`
    );
  }

  if (
    settings.querySuite !== undefined &&
    !VALID_CODE_SCANNING_QUERY_SUITES.includes(settings.querySuite as string)
  ) {
    throw new ValidationError(
      `${context}: querySuite must be one of: ${VALID_CODE_SCANNING_QUERY_SUITES.join(", ")}`
    );
  }

  if (settings.languages !== undefined) {
    if (!Array.isArray(settings.languages)) {
      throw new ValidationError(`${context}: languages must be an array`);
    }
    for (const lang of settings.languages) {
      if (!VALID_CODE_SCANNING_LANGUAGES.includes(lang as string)) {
        throw new ValidationError(
          `${context}: invalid language "${lang}". Valid languages: ${VALID_CODE_SCANNING_LANGUAGES.join(", ")}`
        );
      }
    }
  }
}

function validateConfigId(config: RawConfig): void {
  if (!config.id || typeof config.id !== "string") {
    throw new ValidationError(
      "Config requires an 'id' field. This unique identifier is used to namespace managed files in .xfg.json"
    );
  }

  if (!CONFIG_ID_PATTERN.test(config.id)) {
    throw new ValidationError(
      `Config 'id' contains invalid characters: '${config.id}'. Use only alphanumeric characters, hyphens, and underscores.`
    );
  }

  if (config.id.length > CONFIG_ID_MAX_LENGTH) {
    throw new ValidationError(
      `Config 'id' exceeds maximum length of ${CONFIG_ID_MAX_LENGTH} characters`
    );
  }
}

function validateRootFiles(config: RawConfig): void {
  if (!config.files || Object.keys(config.files).length === 0) return;

  if ("inherit" in config.files) {
    throw new ValidationError(
      "'inherit' is a reserved key and cannot be used as a filename"
    );
  }

  for (const fileName of Object.keys(config.files)) {
    validateFileName(fileName);

    const fileConfig = config.files[fileName];
    if (!isPlainObject(fileConfig)) {
      throw new ValidationError(
        `File '${fileName}' must have a configuration object`
      );
    }

    validateFileConfigFields(
      fileConfig as Record<string, unknown>,
      fileName,
      `File '${fileName}':`
    );
  }
}

function validateRootSettings(config: RawConfig): void {
  if (config.settings === undefined) return;

  validateSettings(config.settings, "Root");

  if (config.settings.rulesets && "inherit" in config.settings.rulesets) {
    throw new ValidationError(
      "'inherit' is a reserved key and cannot be used as a ruleset name"
    );
  }

  if (config.settings.labels && "inherit" in config.settings.labels) {
    throw new ValidationError(
      "'inherit' is a reserved key and cannot be used as a label name"
    );
  }
}

function validateGithubHosts(config: RawConfig): void {
  if (config.githubHosts === undefined) return;

  if (
    !Array.isArray(config.githubHosts) ||
    !config.githubHosts.every((h) => typeof h === "string")
  ) {
    throw new ValidationError("githubHosts must be an array of strings");
  }

  for (const host of config.githubHosts) {
    if (!host) {
      throw new ValidationError(
        "githubHosts entries must be non-empty hostnames"
      );
    }
    if (host.includes("://")) {
      throw new ValidationError(
        `githubHosts entries must be hostnames only, not URLs. Got: ${host}`
      );
    }
    if (host.includes("/")) {
      throw new ValidationError(
        `githubHosts entries must be hostnames only, not paths. Got: ${host}`
      );
    }
  }
}

function validatePrOptions(config: RawConfig): void {
  if (config.prOptions?.labels === undefined) return;

  if (!Array.isArray(config.prOptions.labels)) {
    throw new ValidationError("prOptions.labels must be an array of strings");
  }
  for (const label of config.prOptions.labels) {
    if (typeof label !== "string" || label.length === 0) {
      throw new ValidationError(
        "prOptions.labels entries must be non-empty strings"
      );
    }
  }
}

/**
 * Validates the extends field on a single group definition.
 * Checks type, self-reference, and that all referenced groups exist.
 */
function validateGroupExtends(
  groupName: string,
  extends_: string | string[],
  groupNames: Set<string>
): void {
  // Type check
  if (typeof extends_ === "string") {
    if (extends_.length === 0) {
      throw new ValidationError(
        `groups.${groupName}: 'extends' must be a non-empty string or array of strings`
      );
    }
    // Self-reference
    if (extends_ === groupName) {
      throw new ValidationError(
        `groups.${groupName}: extends cannot reference itself`
      );
    }
    // Existence
    if (!groupNames.has(extends_)) {
      throw new ValidationError(
        `groups.${groupName}: extends references undefined group '${extends_}'`
      );
    }
  } else if (Array.isArray(extends_)) {
    if (extends_.length === 0) {
      throw new ValidationError(
        `groups.${groupName}: 'extends' must be a non-empty string or array of strings`
      );
    }
    const seen = new Set<string>();
    for (const entry of extends_) {
      if (typeof entry !== "string") {
        throw new ValidationError(
          `groups.${groupName}: 'extends' array entries must be strings`
        );
      }
      if (entry.length === 0) {
        throw new ValidationError(
          `groups.${groupName}: 'extends' array entries must be non-empty strings`
        );
      }
      if (entry === groupName) {
        throw new ValidationError(
          `groups.${groupName}: extends cannot reference itself`
        );
      }
      if (!groupNames.has(entry)) {
        throw new ValidationError(
          `groups.${groupName}: extends references undefined group '${entry}'`
        );
      }
      if (seen.has(entry)) {
        throw new ValidationError(
          `groups.${groupName}: duplicate '${entry}' in extends`
        );
      }
      seen.add(entry);
    }
  } else {
    throw new ValidationError(
      `groups.${groupName}: 'extends' must be a non-empty string or array of strings`
    );
  }
}

/**
 * Detects circular extends chains across all groups.
 * Reuses resolveExtendsChain from extends-resolver.ts to avoid
 * duplicating the chain-walking logic. Converts thrown errors
 * to ValidationError.
 */
function validateNoCircularExtends(
  groups: Record<string, RawGroupConfig>
): void {
  for (const name of Object.keys(groups)) {
    if (!groups[name].extends) continue;
    try {
      resolveExtendsChain(name, groups);
    } catch (error) {
      throw new ValidationError(
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}

function validateGroups(config: RawConfig): void {
  if (config.groups === undefined) return;

  if (!isPlainObject(config.groups)) {
    throw new ValidationError("groups must be an object");
  }

  const rootCtx = buildRootSettingsContext(config);
  const groupNames = new Set(Object.keys(config.groups));

  for (const [groupName, group] of Object.entries(config.groups)) {
    if (groupName === "inherit") {
      throw new ValidationError(
        "'inherit' is a reserved key and cannot be used as a group name"
      );
    }

    if (groupName === "extends") {
      throw new ValidationError(
        "'extends' is a reserved key and cannot be used as a group name"
      );
    }

    // Validate extends field
    if (group.extends !== undefined) {
      validateGroupExtends(groupName, group.extends, groupNames);
    }

    if (group.files) {
      for (const [fileName, fileConfig] of Object.entries(group.files)) {
        if (fileName === "inherit") continue;
        if (fileConfig === false) continue;
        if (fileConfig === undefined) continue;

        validateFileConfigFields(
          fileConfig as Record<string, unknown>,
          fileName,
          `groups.${groupName}:`
        );
      }
    }

    if (group.settings !== undefined) {
      validateSettings(group.settings, `groups.${groupName}`, rootCtx);
    }
  }

  // Validate no circular extends after individual validation
  validateNoCircularExtends(config.groups);
}

function validateGroupRefArray(
  arr: unknown,
  fieldName: string,
  ctx: string,
  groupNames: string[]
): void {
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new ValidationError(
      `${ctx}: '${fieldName}' must be a non-empty array of strings`
    );
  }
  const seen = new Set<string>();
  for (const name of arr) {
    if (typeof name !== "string") {
      throw new ValidationError(
        `${ctx}: '${fieldName}' entries must be strings`
      );
    }
    if (!groupNames.includes(name)) {
      throw new ValidationError(
        `${ctx}: group '${name}' in ${fieldName} is not defined in root 'groups'`
      );
    }
    if (seen.has(name)) {
      throw new ValidationError(
        `${ctx}: duplicate group '${name}' in ${fieldName}`
      );
    }
    seen.add(name);
  }
}

function validateConditionalGroups(config: RawConfig): void {
  if (config.conditionalGroups === undefined) return;

  if (!Array.isArray(config.conditionalGroups)) {
    throw new ValidationError("conditionalGroups must be an array");
  }

  const rootCtx = buildRootSettingsContext(config);
  const groupNames = config.groups ? Object.keys(config.groups) : [];

  for (let i = 0; i < config.conditionalGroups.length; i++) {
    const entry = config.conditionalGroups[i];
    const ctx = `conditionalGroups[${i}]`;

    // Validate 'when' clause
    if (!entry.when || !isPlainObject(entry.when)) {
      throw new ValidationError(
        `${ctx}: 'when' is required and must be an object`
      );
    }

    const { allOf, anyOf, noneOf } = entry.when;
    if (!allOf && !anyOf && !noneOf) {
      throw new ValidationError(
        `${ctx}: 'when' must have at least one of 'allOf', 'anyOf', or 'noneOf'`
      );
    }

    if (allOf !== undefined) {
      validateGroupRefArray(allOf, "allOf", ctx, groupNames);
    }

    if (anyOf !== undefined) {
      validateGroupRefArray(anyOf, "anyOf", ctx, groupNames);
    }

    if (noneOf !== undefined) {
      validateGroupRefArray(noneOf, "noneOf", ctx, groupNames);
    }

    // Cross-operator overlap: noneOf must not share groups with allOf or anyOf
    if (noneOf && Array.isArray(noneOf)) {
      const noneOfSet = new Set(noneOf as string[]);
      if (allOf && Array.isArray(allOf)) {
        for (const g of allOf as string[]) {
          if (noneOfSet.has(g)) {
            throw new ValidationError(
              `${ctx}: noneOf group '${g}' overlaps with allOf (contradictory condition)`
            );
          }
        }
      }
      if (anyOf && Array.isArray(anyOf)) {
        for (const g of anyOf as string[]) {
          if (noneOfSet.has(g)) {
            throw new ValidationError(
              `${ctx}: noneOf group '${g}' overlaps with anyOf (contradictory condition)`
            );
          }
        }
      }
    }

    // Validate files
    if (entry.files) {
      for (const [fileName, fileConfig] of Object.entries(entry.files)) {
        if (fileName === "inherit") continue;
        if (fileConfig === false) continue;
        if (fileConfig === undefined) continue;

        validateFileConfigFields(
          fileConfig as Record<string, unknown>,
          fileName,
          `${ctx}:`
        );
      }
    }

    // Validate settings
    if (entry.settings !== undefined) {
      validateSettings(entry.settings, ctx, rootCtx);
    }
  }
}

function validateRepoGitField(
  repo: RawConfig["repos"][number],
  index: number
): string {
  if (!repo.git) {
    throw new ValidationError(
      `Repo at index ${index} missing required field: git`
    );
  }
  if (Array.isArray(repo.git) && repo.git.length === 0) {
    throw new ValidationError(`Repo at index ${index} has empty git array`);
  }
  return getGitDisplayName(repo.git);
}

function validateRepoOrigins(
  config: RawConfig,
  repo: RawConfig["repos"][number],
  repoLabel: string
): void {
  if (repo.upstream !== undefined && repo.source !== undefined) {
    throw new ValidationError(
      `Repo ${repoLabel}: 'upstream' and 'source' are mutually exclusive. ` +
        `Use 'upstream' to fork, or 'source' to migrate, not both.`
    );
  }

  if (repo.upstream !== undefined) {
    if (typeof repo.upstream !== "string") {
      throw new ValidationError(
        `Repo ${repoLabel}: 'upstream' must be a string`
      );
    }
    if (!isValidGitUrl(repo.upstream)) {
      throw new ValidationError(
        `Repo ${repoLabel}: 'upstream' must be a valid git URL ` +
          `(SSH: git@host:path or HTTPS: https://host/path)`
      );
    }
  }

  if (repo.source !== undefined) {
    if (typeof repo.source !== "string") {
      throw new ValidationError(`Repo ${repoLabel}: 'source' must be a string`);
    }
    if (!isValidGitUrl(repo.source)) {
      throw new ValidationError(
        `Repo ${repoLabel}: 'source' must be a valid git URL ` +
          `(SSH: git@host:path or HTTPS: https://host/path)`
      );
    }
    if (isGitHubUrl(repo.source, config.githubHosts)) {
      throw new ValidationError(
        `Repo ${repoLabel}: 'source' cannot be a GitHub URL. ` +
          `Migration from GitHub is not supported. Currently supported sources: Azure DevOps`
      );
    }
  }
}

function validateRepoGroups(
  config: RawConfig,
  repo: RawConfig["repos"][number],
  index: number
): void {
  if (repo.groups === undefined) return;

  if (
    !Array.isArray(repo.groups) ||
    !repo.groups.every((g: unknown) => typeof g === "string")
  ) {
    throw new ValidationError(
      `Repo at index ${index}: groups must be an array of strings`
    );
  }
  const seen = new Set<string>();
  for (const groupName of repo.groups) {
    if (!config.groups || !config.groups[groupName]) {
      throw new ValidationError(
        `Repo at index ${index}: group '${groupName}' is not defined in root 'groups'`
      );
    }
    if (seen.has(groupName)) {
      throw new ValidationError(
        `Repo at index ${index}: duplicate group '${groupName}'`
      );
    }
    seen.add(groupName);
  }
}

function validateRepoFiles(
  config: RawConfig,
  repo: RawConfig["repos"][number],
  index: number,
  repoLabel: string
): void {
  if (!repo.files) return;

  if (!isPlainObject(repo.files)) {
    throw new ValidationError(
      `Repo at index ${index}: files must be an object`
    );
  }

  const knownFiles = new Set<string>(
    config.files ? Object.keys(config.files) : []
  );
  if (repo.groups && config.groups) {
    const expandedGroups = expandRepoGroups(repo.groups, config.groups);
    for (const groupName of expandedGroups) {
      const group = config.groups[groupName];
      if (group?.files) {
        for (const fn of Object.keys(group.files)) {
          if (fn !== "inherit") knownFiles.add(fn);
        }
      }
    }
  }
  if (config.conditionalGroups) {
    for (const cg of config.conditionalGroups) {
      if (cg.files) {
        for (const fn of Object.keys(cg.files)) {
          if (fn !== "inherit") knownFiles.add(fn);
        }
      }
    }
  }

  for (const fileName of Object.keys(repo.files)) {
    if (fileName === "inherit") {
      const inheritValue = (repo.files as Record<string, unknown>).inherit;
      if (typeof inheritValue !== "boolean") {
        throw new ValidationError(
          `Repo at index ${index}: files.inherit must be a boolean`
        );
      }
      continue;
    }

    if (!knownFiles.has(fileName)) {
      throw new ValidationError(
        `Repo at index ${index} references undefined file '${fileName}'. File must be defined in root 'files' object or in a referenced group.`
      );
    }

    const fileOverride = repo.files[fileName];

    if (fileOverride === false) {
      continue;
    }

    if (fileOverride.override && !fileOverride.content) {
      throw new ValidationError(
        `Repo ${repoLabel} has override: true for file '${fileName}' but no content defined. ` +
          `Use content: "" for an empty text file override, or content: {} for an empty JSON/YAML override.`
      );
    }

    validateFileConfigFields(
      fileOverride as Record<string, unknown>,
      fileName,
      `Repo ${repoLabel}:`
    );
  }
}

function validateRepoSettingsEntry(
  config: RawConfig,
  repo: RawConfig["repos"][number],
  repoLabel: string
): void {
  if (repo.settings === undefined) return;

  const rootCtx = buildRootSettingsContext(config);

  if (repo.groups && config.groups) {
    const expandedGroups = expandRepoGroups(repo.groups, config.groups);
    for (const groupName of expandedGroups) {
      const group = config.groups[groupName];
      if (group?.settings?.rulesets) {
        for (const name of Object.keys(group.settings.rulesets)) {
          if (name !== "inherit") rootCtx.rulesetNames.push(name);
        }
      }
      if (group?.settings?.labels) {
        for (const name of Object.keys(group.settings.labels)) {
          if (name !== "inherit") rootCtx.labelNames.push(name);
        }
      }
      if (
        group?.settings?.repo !== undefined &&
        group.settings.repo !== false
      ) {
        rootCtx.hasRepoSettings = true;
      }
      if (
        group?.settings?.codeScanning !== undefined &&
        group.settings.codeScanning !== false
      ) {
        rootCtx.hasCodeScanningSettings = true;
      }
    }
  }
  if (config.conditionalGroups) {
    for (const cg of config.conditionalGroups) {
      if (cg.settings?.rulesets) {
        for (const name of Object.keys(cg.settings.rulesets)) {
          if (name !== "inherit") rootCtx.rulesetNames.push(name);
        }
      }
      if (cg.settings?.labels) {
        for (const name of Object.keys(cg.settings.labels)) {
          if (name !== "inherit") rootCtx.labelNames.push(name);
        }
      }
      if (cg.settings?.repo !== undefined && cg.settings.repo !== false) {
        rootCtx.hasRepoSettings = true;
      }
      if (
        cg.settings?.codeScanning !== undefined &&
        cg.settings.codeScanning !== false
      ) {
        rootCtx.hasCodeScanningSettings = true;
      }
    }
  }

  validateSettings(repo.settings, `Repo ${repoLabel}`, rootCtx);
}

function validateRepoEntry(
  config: RawConfig,
  repo: RawConfig["repos"][number],
  index: number
): void {
  const repoLabel = validateRepoGitField(repo, index);
  validateRepoOrigins(config, repo, repoLabel);
  validateRepoGroups(config, repo, index);
  validateRepoFiles(config, repo, index, repoLabel);
  validateRepoSettingsEntry(config, repo, repoLabel);
}

function hasGroupFiles(config: RawConfig): boolean {
  return (
    isPlainObject(config.groups) &&
    Object.values(config.groups).some(
      (g) =>
        g.files &&
        Object.keys(g.files).filter(
          (k) => k !== "inherit" && g.files![k] !== false
        ).length > 0
    )
  );
}

function hasConditionalGroupFiles(config: RawConfig): boolean {
  return (
    Array.isArray(config.conditionalGroups) &&
    config.conditionalGroups.some(
      (cg) =>
        cg.files &&
        Object.keys(cg.files).filter(
          (k) => k !== "inherit" && cg.files![k] !== false
        ).length > 0
    )
  );
}

function hasConditionalGroupSettings(
  config: RawConfig,
  predicate: (settings: NonNullable<unknown>) => boolean
): boolean {
  return (
    Array.isArray(config.conditionalGroups) &&
    config.conditionalGroups.some((cg) => cg.settings && predicate(cg.settings))
  );
}

function hasConditionalGroupPR(config: RawConfig): boolean {
  return (
    Array.isArray(config.conditionalGroups) &&
    config.conditionalGroups.some(
      (cg) => cg.prOptions && isPlainObject(cg.prOptions)
    )
  );
}

/**
 * Validates raw config structure before normalization.
 * @throws ValidationError if validation fails
 */
export function validateRawConfig(config: RawConfig): void {
  validateConfigId(config);

  const hasFiles =
    isPlainObject(config.files) && Object.keys(config.files).length > 0;
  const hasSettings = isPlainObject(config.settings);
  const hasGrpFiles = hasGroupFiles(config);
  const hasGrpSettings =
    isPlainObject(config.groups) &&
    Object.values(config.groups).some(
      (g) => g.settings && isPlainObject(g.settings)
    );
  const hasCondGrpFiles = hasConditionalGroupFiles(config);
  const hasCondGrpSettings = hasConditionalGroupSettings(config, isPlainObject);
  const hasCondGrpPR = hasConditionalGroupPR(config);

  if (
    !hasFiles &&
    !hasSettings &&
    !hasGrpFiles &&
    !hasGrpSettings &&
    !hasCondGrpFiles &&
    !hasCondGrpSettings &&
    !hasCondGrpPR
  ) {
    throw new ValidationError(
      "Config requires at least one of: 'files' or 'settings'. " +
        "Use 'files' to sync configuration files, or 'settings' to manage repository settings."
    );
  }

  validateRootFiles(config);

  if (
    config.deleteOrphaned !== undefined &&
    typeof config.deleteOrphaned !== "boolean"
  ) {
    throw new ValidationError("Global deleteOrphaned must be a boolean");
  }

  if (!config.repos || !Array.isArray(config.repos)) {
    throw new ValidationError(
      "Config missing required field: repos (must be an array)"
    );
  }

  validateRootSettings(config);
  validateGithubHosts(config);
  validatePrOptions(config);
  validateGroups(config);
  validateConditionalGroups(config);

  for (let i = 0; i < config.repos.length; i++) {
    validateRepoEntry(config, config.repos[i], i);
  }
}

// =============================================================================
// Command-Specific Validators
// =============================================================================

/**
 * Validates that config is suitable for the sync command.
 * @throws ValidationError if neither files nor settings are present
 */
export function validateForSync(config: RawConfig): void {
  const hasRootFiles = config.files && Object.keys(config.files).length > 0;
  const hasGrpFiles = hasGroupFiles(config);
  const hasSettings = hasActionableSettings(config.settings);
  const hasRepoSettings = config.repos.some((repo) =>
    hasActionableSettings(repo.settings)
  );
  const hasGroupSettings =
    isPlainObject(config.groups) &&
    Object.values(config.groups).some(
      (g) => g.settings && hasActionableSettings(g.settings)
    );
  const hasCondGrpFiles = hasConditionalGroupFiles(config);
  const hasCondGrpSettings = hasConditionalGroupSettings(
    config,
    hasActionableSettings
  );
  const hasCondGrpPR = hasConditionalGroupPR(config);

  if (
    !hasRootFiles &&
    !hasGrpFiles &&
    !hasSettings &&
    !hasRepoSettings &&
    !hasGroupSettings &&
    !hasCondGrpFiles &&
    !hasCondGrpSettings &&
    !hasCondGrpPR
  ) {
    throw new ValidationError(
      "Config requires at least one of: 'files' or 'settings'. " +
        "Use 'files' to sync configuration files, or 'settings' to manage repository settings."
    );
  }
}

/**
 * Checks if settings contain actionable configuration.
 */
export function hasActionableSettings(
  settings: RawRootSettings | RawRepoSettings | undefined
): boolean {
  if (!settings) return false;

  if (
    settings.rulesets &&
    Object.keys(settings.rulesets).filter((k) => k !== "inherit").length > 0
  ) {
    return true;
  }

  if (settings.repo && Object.keys(settings.repo).length > 0) {
    return true;
  }

  if (
    settings.labels &&
    Object.keys(settings.labels).filter((k) => k !== "inherit").length > 0
  ) {
    return true;
  }

  if (settings.codeScanning && typeof settings.codeScanning === "object") {
    return true;
  }

  return false;
}
