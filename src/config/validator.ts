import type {
  RawConfig,
  RawRootSettings,
  RawRepoSettings,
  SecretConfig,
} from "./types.js";
import { validateFileName } from "./validators/file-validator.js";
import { isPlainObject } from "../shared/type-guards.js";
import { ValidationError } from "../shared/errors.js";
import { validateBranchName } from "../shared/branch-validation.js";
import {
  validateFileConfigFields,
  validateSettings,
} from "./validators/shared.js";
import {
  validateGroups,
  validateConditionalGroups,
} from "./validators/group-validator.js";
import { validateRepoEntry } from "./validators/repo-entry-validator.js";

const CONFIG_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const VARIABLE_RESERVED_KEYS = new Set(["deleteOrphaned", "inherit"]);
const CONFIG_ID_MAX_LENGTH = 64;

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

  if (config.settings.variables && "inherit" in config.settings.variables) {
    throw new ValidationError(
      "'inherit' is not allowed in root-level variables (nothing to inherit from)"
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
  if (config.prOptions?.branch !== undefined) {
    validateBranchName(config.prOptions.branch);
  }

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

function hasConditionalGroupSettingsPresent(config: RawConfig): boolean {
  return (
    Array.isArray(config.conditionalGroups) &&
    config.conditionalGroups.some(
      (cg) => cg.settings && isPlainObject(cg.settings)
    )
  );
}

function hasConditionalGroupSettingsActionable(config: RawConfig): boolean {
  return (
    Array.isArray(config.conditionalGroups) &&
    config.conditionalGroups.some(
      (cg) => cg.settings && hasActionableSettings(cg.settings)
    )
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

function hasGroupSettingsPresent(config: RawConfig): boolean {
  return (
    isPlainObject(config.groups) &&
    Object.values(config.groups).some(
      (g) => g.settings && isPlainObject(g.settings)
    )
  );
}

function hasGroupSettingsActionable(config: RawConfig): boolean {
  return (
    isPlainObject(config.groups) &&
    Object.values(config.groups).some(
      (g) => g.settings && hasActionableSettings(g.settings)
    )
  );
}

/** Flags shared by both structural and sync validation. */
interface ContentPresenceFlags {
  hasRootFiles: boolean;
  hasGrpFiles: boolean;
  hasCondGrpFiles: boolean;
  hasCondGrpPR: boolean;
}

function computeContentPresenceFlags(config: RawConfig): ContentPresenceFlags {
  return {
    hasRootFiles:
      isPlainObject(config.files) && Object.keys(config.files).length > 0,
    hasGrpFiles: hasGroupFiles(config),
    hasCondGrpFiles: hasConditionalGroupFiles(config),
    hasCondGrpPR: hasConditionalGroupPR(config),
  };
}

/**
 * Validates raw config structure before normalization.
 * @throws ValidationError if validation fails
 */
export function validateRawConfig(config: RawConfig): void {
  validateConfigId(config);

  const { hasRootFiles, hasGrpFiles, hasCondGrpFiles, hasCondGrpPR } =
    computeContentPresenceFlags(config);
  const hasSettings = isPlainObject(config.settings);
  const hasGrpSettings = hasGroupSettingsPresent(config);
  const hasCondGrpSettings = hasConditionalGroupSettingsPresent(config);
  const hasSecrets =
    isPlainObject(config.secrets) && Object.keys(config.secrets).length > 0;

  if (
    !hasRootFiles &&
    !hasSettings &&
    !hasGrpFiles &&
    !hasGrpSettings &&
    !hasCondGrpFiles &&
    !hasCondGrpSettings &&
    !hasCondGrpPR &&
    !hasSecrets
  ) {
    throw new ValidationError(
      "Config requires at least one of: 'files', 'settings', or 'secrets'. " +
        "Use 'files' to sync configuration files, 'settings' to manage repository settings, " +
        "or 'secrets' to manage GitHub Actions secrets."
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

/**
 * Validates that config is suitable for the sync command.
 * @throws ValidationError if neither files nor settings are present
 */
export function validateForSync(config: RawConfig): void {
  const { hasRootFiles, hasGrpFiles, hasCondGrpFiles, hasCondGrpPR } =
    computeContentPresenceFlags(config);
  const hasSettings = hasActionableSettings(config.settings);
  const hasRepoSettings = config.repos.some((repo) =>
    hasActionableSettings(repo.settings)
  );
  const hasGroupSettings = hasGroupSettingsActionable(config);
  const hasCondGrpSettings = hasConditionalGroupSettingsActionable(config);

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
      "Config requires at least one of: 'files' or 'settings' (rulesets, labels, variables, repo config). " +
        "Use 'files' to sync configuration files, or 'settings' to manage repository settings. " +
        "For secrets, use 'xfg secrets sync'."
    );
  }

  // Validate variable names across all settings
  const allSettings: (RawRootSettings | RawRepoSettings | undefined)[] = [
    config.settings,
    ...config.repos.map((r) => r.settings),
    ...Object.values(config.groups ?? {}).map((g) => g.settings),
    ...(config.conditionalGroups ?? []).map((cg) => cg.settings),
  ];
  for (const settings of allSettings) {
    if (!settings?.variables) continue;
    const vars = settings.variables as Record<string, unknown>;

    if (
      vars.deleteOrphaned !== undefined &&
      typeof vars.deleteOrphaned !== "boolean"
    ) {
      throw new ValidationError("variables.deleteOrphaned must be a boolean");
    }
    if (vars.inherit !== undefined && typeof vars.inherit !== "boolean") {
      throw new ValidationError("variables.inherit must be a boolean");
    }

    for (const [name, value] of Object.entries(vars)) {
      if (VARIABLE_RESERVED_KEYS.has(name)) continue;
      validateVariableName(name);
      if (value !== false && typeof value !== "string") {
        throw new ValidationError(
          `Variable '${name}' must have a string value (got ${typeof value}). Quote numeric values in YAML: "${String(value)}".`
        );
      }
    }

    // Reject duplicate case-insensitive variable names
    const seenVarNames = new Map<string, string>();
    for (const name of Object.keys(settings.variables)) {
      if (VARIABLE_RESERVED_KEYS.has(name)) continue;
      const upper = name.toUpperCase();
      const existing = seenVarNames.get(upper);
      if (existing) {
        throw new ValidationError(
          `Duplicate variable name: '${name}' and '${existing}' collide (GitHub treats variable names case-insensitively).`
        );
      }
      seenVarNames.set(upper, name);
    }
  }

  // Validate secret names and configs
  validateSecretsConfig(config);

  // Cross-validate: no overlap between global secret names and variable names
  validateVariableSecretOverlaps(config);
}

function checkVariableSecretOverlap(
  vars: Record<string, unknown>,
  secretNames: Set<string>,
  context: string
): void {
  const { deleteOrphaned: _d, inherit: _i, ...varEntries } = vars;
  const variableNames = Object.keys(varEntries).filter(
    (k) => typeof varEntries[k] !== "boolean"
  );
  const overlapping = variableNames.filter((n) =>
    secretNames.has(n.toUpperCase())
  );
  if (overlapping.length > 0) {
    throw new ValidationError(
      `${context}${overlapping.join(", ")} overlap between variables and secrets. ` +
        "GitHub does not allow variables and secrets with the same name."
    );
  }
}

export function validateVariableSecretOverlaps(config: RawConfig): void {
  if (!config.secrets) return;

  const { deleteOrphaned: _, ...secretEntries } = config.secrets;
  // GitHub treats secret/variable names case-insensitively for collision purposes
  const secretNames = new Set(
    Object.keys(secretEntries)
      .filter((k) => typeof secretEntries[k] !== "boolean")
      .map((n) => n.toUpperCase())
  );

  if (secretNames.size === 0) return;

  // Check root-level variables
  if (config.settings?.variables) {
    checkVariableSecretOverlap(
      config.settings.variables as Record<string, unknown>,
      secretNames,
      ""
    );
  }

  // Check repo-level variables
  for (const repo of config.repos) {
    checkVariableSecretOverlap(
      (repo.settings?.variables ?? {}) as Record<string, unknown>,
      secretNames,
      `Repo '${repo.git}': `
    );
  }

  // Check group-level variables
  if (isPlainObject(config.groups)) {
    for (const [groupName, group] of Object.entries(config.groups)) {
      if (!group.settings?.variables) continue;
      checkVariableSecretOverlap(
        group.settings.variables as Record<string, unknown>,
        secretNames,
        `Group '${groupName}': `
      );
    }
  }

  // Check conditional group-level variables
  if (Array.isArray(config.conditionalGroups)) {
    for (let i = 0; i < config.conditionalGroups.length; i++) {
      const cg = config.conditionalGroups[i];
      if (!cg.settings?.variables) continue;
      checkVariableSecretOverlap(
        cg.settings.variables as Record<string, unknown>,
        secretNames,
        `Conditional group ${i}: `
      );
    }
  }
}

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

  if (settings.codeScanning) {
    return true;
  }

  if (settings.variables) {
    const {
      deleteOrphaned,
      inherit: _i,
      ...entries
    } = settings.variables as Record<string, unknown>;
    if (Object.keys(entries).length > 0 || deleteOrphaned === true) {
      return true;
    }
  }

  return false;
}

function validateGitHubResourceName(
  name: string,
  kind: "Variable" | "Secret"
): void {
  if (!VARIABLE_NAME_PATTERN.test(name)) {
    throw new ValidationError(
      `${kind} name '${name}' contains invalid characters. Only alphanumeric and underscore allowed.`
    );
  }
  if (name.startsWith("GITHUB_")) {
    throw new ValidationError(
      `${kind} name '${name}' cannot start with 'GITHUB_' (reserved prefix).`
    );
  }
}

export function validateVariableName(name: string): void {
  validateGitHubResourceName(name, "Variable");
}

export function validateSecretName(name: string): void {
  validateGitHubResourceName(name, "Secret");
}

function validateSecretEntry(name: string, config: SecretConfig): void {
  validateSecretName(name);
  if (!config.env || typeof config.env !== "string") {
    throw new ValidationError(
      `Secret '${name}' requires an 'env' field (string) specifying the environment variable source.`
    );
  }
}

export function validateSecretsConfig(config: RawConfig): void {
  if (!config.secrets) return;

  const { deleteOrphaned, ...entries } = config.secrets;

  // Reject 'deleteOrphaned' used as a secret name (it's a reserved peer key)
  if (deleteOrphaned !== undefined && typeof deleteOrphaned !== "boolean") {
    throw new ValidationError(
      "'deleteOrphaned' is a reserved key in secrets config and cannot be used as a secret name."
    );
  }

  // Reject boolean true — only false (opt-out) is valid
  for (const [name, value] of Object.entries(entries)) {
    if (value === true) {
      throw new ValidationError(
        `Secret '${name}' is set to true, which is not valid. Use false to opt out, or provide a SecretConfig object.`
      );
    }
  }

  // Reject duplicate case-insensitive secret names
  const seen = new Map<string, string>();
  for (const name of Object.keys(entries)) {
    const upper = name.toUpperCase();
    const existing = seen.get(upper);
    if (existing) {
      throw new ValidationError(
        `Duplicate secret name: '${name}' and '${existing}' collide (GitHub treats secret names case-insensitively).`
      );
    }
    seen.set(upper, name);
  }

  for (const [name, value] of Object.entries(entries)) {
    if (typeof value === "boolean") continue;
    validateSecretEntry(name, value as SecretConfig);
  }
}
