import type {
  Config,
  RawConfig,
  RawRootSettings,
  RawRepoSettings,
  RepoSettings,
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
const SECRET_RESERVED_KEYS = new Set(["deleteOrphaned", "inherit"]);
const CONFIG_ID_MAX_LENGTH = 64;

function validateNoRootLevelSecrets(config: RawConfig): void {
  if ((config as unknown as Record<string, unknown>).secrets === undefined) {
    return;
  }
  throw new ValidationError(
    "Root-level 'secrets' is no longer supported — move it under 'settings.secrets'. " +
      "Secrets can now also be scoped per group and per repo. " +
      "See https://anthony-spruyt.github.io/xfg/migration-v7/"
  );
}

function collectAllSettings(
  config: RawConfig
): (RawRootSettings | RawRepoSettings | undefined)[] {
  return [
    config.settings,
    ...(Array.isArray(config.repos) ? config.repos.map((r) => r.settings) : []),
    ...Object.values(config.groups ?? {}).map((g) => g.settings),
    ...(config.conditionalGroups ?? []).map((cg) => cg.settings),
  ];
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

  if (config.settings.variables && "inherit" in config.settings.variables) {
    throw new ValidationError(
      "'inherit' is not allowed in root-level variables (nothing to inherit from)"
    );
  }

  if (config.settings.secrets && "inherit" in config.settings.secrets) {
    throw new ValidationError(
      "'inherit' is not allowed in root-level secrets (nothing to inherit from)"
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

/**
 * Validates raw config structure before normalization.
 * @throws ValidationError if validation fails
 */
export function validateRawConfig(config: RawConfig): void {
  // Must run before the "nothing to do" check below, or an old secrets-only
  // config trips the generic error and never sees the migration message.
  validateNoRootLevelSecrets(config);

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
  const hasCondGrpSettings = hasConditionalGroupSettingsPresent(config);
  const hasCondGrpPR = hasConditionalGroupPR(config);
  // config.repos is not confirmed to be an array until further down.
  const hasRepoSettings =
    Array.isArray(config.repos) &&
    config.repos.some((r) => isPlainObject(r.settings));

  if (
    !hasFiles &&
    !hasSettings &&
    !hasGrpFiles &&
    !hasGrpSettings &&
    !hasCondGrpFiles &&
    !hasCondGrpSettings &&
    !hasCondGrpPR &&
    !hasRepoSettings
  ) {
    throw new ValidationError(
      "Config requires at least one of: 'files' or 'settings'. " +
        "Use 'files' to sync configuration files, or 'settings' to manage repository " +
        "settings, variables, and secrets."
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
  const hasCondGrpSettings = hasConditionalGroupSettingsActionable(config);
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
      "Config requires at least one of: 'files' or 'settings' (rulesets, labels, variables, repo config). " +
        "Use 'files' to sync configuration files, or 'settings' to manage repository settings. " +
        "For secrets, use 'xfg secrets sync'."
    );
  }

  // Validate variable names across all settings
  for (const settings of collectAllSettings(config)) {
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
}

const ENTRY_MAP_META_KEYS = new Set(["deleteOrphaned", "inherit"]);

function entryNames(map: Record<string, unknown> | undefined): string[] {
  if (!map) return [];
  return Object.keys(map).filter(
    (k) => !ENTRY_MAP_META_KEYS.has(k) && typeof map[k] !== "boolean"
  );
}

function assertNoOverlap(
  settings: RepoSettings | undefined,
  context: string
): void {
  const secretNames = new Set(
    entryNames(settings?.secrets as Record<string, unknown> | undefined).map(
      (n) => n.toUpperCase()
    )
  );
  if (secretNames.size === 0) return;

  const overlapping = entryNames(
    settings?.variables as Record<string, unknown> | undefined
  ).filter((n) => secretNames.has(n.toUpperCase()));

  if (overlapping.length > 0) {
    throw new ValidationError(
      `${context}: ${overlapping.join(", ")} overlap between variables and secrets. ` +
        "GitHub does not allow variables and secrets with the same name."
    );
  }
}

/**
 * Cross-validates the MERGED settings of each repo: a variable and a secret with
 * the same name collide at GitHub. Must run post-normalize — a per-layer check
 * misses a root secret colliding with a repo variable.
 */
export function validateNormalizedConfig(config: Config): void {
  // config.repos never covers a root-only collision when repos is empty.
  assertNoOverlap(config.settings, "Root settings");

  for (const repo of config.repos) {
    assertNoOverlap(repo.settings, `Repo '${repo.git}'`);
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

  // Secrets are deliberately absent: `xfg sync` must never process them.
  // A secrets-only config leaves `xfg sync` with nothing to do.
  return false;
}

export function validateVariableName(name: string): void {
  if (!VARIABLE_NAME_PATTERN.test(name)) {
    throw new ValidationError(
      `Variable name '${name}' contains invalid characters. Only alphanumeric and underscore allowed.`
    );
  }
  if (name.startsWith("GITHUB_")) {
    throw new ValidationError(
      `Variable name '${name}' cannot start with 'GITHUB_' (reserved prefix).`
    );
  }
}

export function validateSecretName(name: string): void {
  if (!VARIABLE_NAME_PATTERN.test(name)) {
    throw new ValidationError(
      `Secret name '${name}' contains invalid characters. Only alphanumeric and underscore allowed.`
    );
  }
  if (name.startsWith("GITHUB_")) {
    throw new ValidationError(
      `Secret name '${name}' cannot start with 'GITHUB_' (reserved prefix).`
    );
  }
}

function validateSecretEntry(name: string, config: SecretConfig): void {
  validateSecretName(name);
  if (!config.env || typeof config.env !== "string") {
    throw new ValidationError(
      `Secret '${name}' requires an 'env' field (string) specifying the environment variable source.`
    );
  }
}

function validateSecretsLayer(secrets: Record<string, unknown>): void {
  const { deleteOrphaned, inherit } = secrets;

  if (deleteOrphaned !== undefined && typeof deleteOrphaned !== "boolean") {
    throw new ValidationError(
      "'deleteOrphaned' is a reserved key in secrets config and cannot be used as a secret name."
    );
  }

  if (inherit !== undefined && typeof inherit !== "boolean") {
    throw new ValidationError(
      "'inherit' is a reserved key in secrets config and cannot be used as a secret name."
    );
  }

  // Reject boolean true — only false (opt-out) is valid
  for (const [name, value] of Object.entries(secrets)) {
    if (SECRET_RESERVED_KEYS.has(name)) continue;
    if (value === true) {
      throw new ValidationError(
        `Secret '${name}' is set to true, which is not valid. Use false to opt out, or provide a SecretConfig object.`
      );
    }
  }

  // Reject duplicate case-insensitive secret names
  const seen = new Map<string, string>();
  for (const name of Object.keys(secrets)) {
    if (SECRET_RESERVED_KEYS.has(name)) continue;
    const upper = name.toUpperCase();
    const existing = seen.get(upper);
    if (existing) {
      throw new ValidationError(
        `Duplicate secret name: '${name}' and '${existing}' collide (GitHub treats secret names case-insensitively).`
      );
    }
    seen.set(upper, name);
  }

  for (const [name, value] of Object.entries(secrets)) {
    if (SECRET_RESERVED_KEYS.has(name)) continue;
    if (typeof value === "boolean") continue;
    validateSecretEntry(name, value as SecretConfig);
  }
}

export function validateSecretsConfig(config: RawConfig): void {
  for (const settings of collectAllSettings(config)) {
    if (!settings?.secrets) continue;
    validateSecretsLayer(settings.secrets as Record<string, unknown>);
  }
}
