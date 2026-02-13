import type { RawConfig, RawRepoSettings } from "./types.js";
import {
  isTextContent,
  isObjectContent,
  isStructuredFileExtension,
  validateFileName,
  VALID_STRATEGIES,
} from "./validators/file-validator.js";
import { validateRepoSettings } from "./validators/repo-settings-validator.js";
import { validateRuleset } from "./validators/ruleset-validator.js";

// Pattern for valid config ID: alphanumeric, hyphens, underscores
const CONFIG_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const CONFIG_ID_MAX_LENGTH = 64;

/**
 * Check if a string looks like a valid git URL.
 * Supports SSH (git@host:path) and HTTPS (https://host/path) formats.
 */
function isValidGitUrl(url: string): boolean {
  // SSH format: git@hostname:path
  if (/^git@[^:]+:.+$/.test(url)) {
    return true;
  }
  // HTTPS format: https://hostname/path
  if (/^https?:\/\/[^/]+\/.+$/.test(url)) {
    return true;
  }
  return false;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
 * Validates settings object containing rulesets.
 */
export function validateSettings(
  settings: unknown,
  context: string,
  rootRulesetNames?: string[],
  hasRootRepoSettings?: boolean
): void {
  if (
    typeof settings !== "object" ||
    settings === null ||
    Array.isArray(settings)
  ) {
    throw new Error(`${context}: settings must be an object`);
  }

  const s = settings as Record<string, unknown>;

  if (s.rulesets !== undefined) {
    if (
      typeof s.rulesets !== "object" ||
      s.rulesets === null ||
      Array.isArray(s.rulesets)
    ) {
      throw new Error(`${context}: rulesets must be an object`);
    }

    const rulesets = s.rulesets as Record<string, unknown>;
    for (const [name, ruleset] of Object.entries(rulesets)) {
      // Skip reserved key
      if (name === "inherit") continue;

      // Check for opt-out of non-existent root ruleset
      if (ruleset === false) {
        if (rootRulesetNames && !rootRulesetNames.includes(name)) {
          throw new Error(
            `${context}: Cannot opt out of '${name}' - not defined in root settings.rulesets`
          );
        }
        continue; // Skip further validation for false entries
      }

      validateRuleset(ruleset, name, context);
    }
  }

  if (s.deleteOrphaned !== undefined && typeof s.deleteOrphaned !== "boolean") {
    throw new Error(`${context}: settings.deleteOrphaned must be a boolean`);
  }

  // Validate repo settings
  if (s.repo !== undefined) {
    if (s.repo === false) {
      if (!rootRulesetNames) {
        // Root level — repo: false not valid here
        throw new Error(
          `${context}: repo: false is not valid at root level. Define repo settings or remove the field.`
        );
      }
      // Per-repo level — check root has repo settings to opt out of
      if (!hasRootRepoSettings) {
        throw new Error(
          `${context}: Cannot opt out of repo settings — not defined in root settings.repo`
        );
      }
      // Valid opt-out, skip further repo validation
    } else {
      validateRepoSettings(s.repo, context);
    }
  }
}

/**
 * Validates raw config structure before normalization.
 * @throws Error if validation fails
 */
export function validateRawConfig(config: RawConfig): void {
  // Validate required id field
  if (!config.id || typeof config.id !== "string") {
    throw new Error(
      "Config requires an 'id' field. This unique identifier is used to namespace managed files in .xfg.json"
    );
  }

  if (!CONFIG_ID_PATTERN.test(config.id)) {
    throw new Error(
      `Config 'id' contains invalid characters: '${config.id}'. Use only alphanumeric characters, hyphens, and underscores.`
    );
  }

  if (config.id.length > CONFIG_ID_MAX_LENGTH) {
    throw new Error(
      `Config 'id' exceeds maximum length of ${CONFIG_ID_MAX_LENGTH} characters`
    );
  }

  // Validate at least one of files or settings exists
  const hasFiles =
    config.files &&
    typeof config.files === "object" &&
    Object.keys(config.files).length > 0;
  const hasSettings = config.settings && typeof config.settings === "object";

  if (!hasFiles && !hasSettings) {
    throw new Error(
      "Config requires at least one of: 'files' or 'settings'. " +
        "Use 'files' to sync configuration files, or 'settings' to manage repository settings."
    );
  }

  const fileNames = hasFiles ? Object.keys(config.files!) : [];

  // Check for reserved key 'inherit' at root files level
  if (hasFiles && "inherit" in config.files!) {
    throw new Error(
      "'inherit' is a reserved key and cannot be used as a filename"
    );
  }

  // Validate each file definition
  for (const fileName of fileNames) {
    validateFileName(fileName);

    const fileConfig = config.files![fileName];
    if (!fileConfig || typeof fileConfig !== "object") {
      throw new Error(`File '${fileName}' must have a configuration object`);
    }

    // Validate content type
    if (fileConfig.content !== undefined) {
      const hasText = isTextContent(fileConfig.content);
      const hasObject = isObjectContent(fileConfig.content);

      if (!hasText && !hasObject) {
        throw new Error(
          `File '${fileName}' content must be an object, string, or array of strings`
        );
      }

      // Validate content type matches file extension
      const isStructured = isStructuredFileExtension(fileName);
      if (isStructured && hasText) {
        throw new Error(
          `File '${fileName}' has JSON/YAML extension but string content. Use object content for structured files.`
        );
      }
      if (!isStructured && hasObject) {
        throw new Error(
          `File '${fileName}' has text extension but object content. Use string or string[] for text files, or use .json/.yaml/.yml extension.`
        );
      }
    }

    if (
      fileConfig.mergeStrategy !== undefined &&
      !VALID_STRATEGIES.includes(fileConfig.mergeStrategy)
    ) {
      throw new Error(
        `File '${fileName}' has invalid mergeStrategy: ${fileConfig.mergeStrategy}. Must be one of: ${VALID_STRATEGIES.join(", ")}`
      );
    }

    if (
      fileConfig.createOnly !== undefined &&
      typeof fileConfig.createOnly !== "boolean"
    ) {
      throw new Error(`File '${fileName}' createOnly must be a boolean`);
    }

    if (
      fileConfig.executable !== undefined &&
      typeof fileConfig.executable !== "boolean"
    ) {
      throw new Error(`File '${fileName}' executable must be a boolean`);
    }

    if (fileConfig.header !== undefined) {
      if (
        typeof fileConfig.header !== "string" &&
        (!Array.isArray(fileConfig.header) ||
          !fileConfig.header.every((h) => typeof h === "string"))
      ) {
        throw new Error(
          `File '${fileName}' header must be a string or array of strings`
        );
      }
    }

    if (
      fileConfig.schemaUrl !== undefined &&
      typeof fileConfig.schemaUrl !== "string"
    ) {
      throw new Error(`File '${fileName}' schemaUrl must be a string`);
    }

    if (
      fileConfig.template !== undefined &&
      typeof fileConfig.template !== "boolean"
    ) {
      throw new Error(`File '${fileName}' template must be a boolean`);
    }

    if (fileConfig.vars !== undefined) {
      if (
        typeof fileConfig.vars !== "object" ||
        fileConfig.vars === null ||
        Array.isArray(fileConfig.vars)
      ) {
        throw new Error(
          `File '${fileName}' vars must be an object with string values`
        );
      }
      for (const [key, value] of Object.entries(fileConfig.vars)) {
        if (typeof value !== "string") {
          throw new Error(`File '${fileName}' vars.${key} must be a string`);
        }
      }
    }

    if (
      fileConfig.deleteOrphaned !== undefined &&
      typeof fileConfig.deleteOrphaned !== "boolean"
    ) {
      throw new Error(`File '${fileName}' deleteOrphaned must be a boolean`);
    }
  }

  // Validate global deleteOrphaned
  if (
    config.deleteOrphaned !== undefined &&
    typeof config.deleteOrphaned !== "boolean"
  ) {
    throw new Error("Global deleteOrphaned must be a boolean");
  }

  if (!config.repos || !Array.isArray(config.repos)) {
    throw new Error("Config missing required field: repos (must be an array)");
  }

  // Validate root settings
  if (config.settings !== undefined) {
    validateSettings(config.settings, "Root");

    // Check for reserved key 'inherit' at root rulesets level
    if (config.settings.rulesets && "inherit" in config.settings.rulesets) {
      throw new Error(
        "'inherit' is a reserved key and cannot be used as a ruleset name"
      );
    }
  }

  // Validate githubHosts if provided
  if (config.githubHosts !== undefined) {
    if (
      !Array.isArray(config.githubHosts) ||
      !config.githubHosts.every((h) => typeof h === "string")
    ) {
      throw new Error("githubHosts must be an array of strings");
    }

    for (const host of config.githubHosts) {
      if (!host) {
        throw new Error("githubHosts entries must be non-empty hostnames");
      }
      if (host.includes("://")) {
        throw new Error(
          `githubHosts entries must be hostnames only, not URLs. Got: ${host}`
        );
      }
      if (host.includes("/")) {
        throw new Error(
          `githubHosts entries must be hostnames only, not paths. Got: ${host}`
        );
      }
    }
  }

  // Validate each repo
  for (let i = 0; i < config.repos.length; i++) {
    const repo = config.repos[i];
    if (!repo.git) {
      throw new Error(`Repo at index ${i} missing required field: git`);
    }
    if (Array.isArray(repo.git) && repo.git.length === 0) {
      throw new Error(`Repo at index ${i} has empty git array`);
    }

    // Validate lifecycle fields (upstream/source)
    if (repo.upstream !== undefined && repo.source !== undefined) {
      throw new Error(
        `Repo ${getGitDisplayName(repo.git)}: 'upstream' and 'source' are mutually exclusive. ` +
          `Use 'upstream' to fork, or 'source' to migrate, not both.`
      );
    }

    if (repo.upstream !== undefined) {
      if (typeof repo.upstream !== "string") {
        throw new Error(
          `Repo ${getGitDisplayName(repo.git)}: 'upstream' must be a string`
        );
      }
      if (!isValidGitUrl(repo.upstream)) {
        throw new Error(
          `Repo ${getGitDisplayName(repo.git)}: 'upstream' must be a valid git URL ` +
            `(SSH: git@host:path or HTTPS: https://host/path)`
        );
      }
    }

    if (repo.source !== undefined) {
      if (typeof repo.source !== "string") {
        throw new Error(
          `Repo ${getGitDisplayName(repo.git)}: 'source' must be a string`
        );
      }
      if (!isValidGitUrl(repo.source)) {
        throw new Error(
          `Repo ${getGitDisplayName(repo.git)}: 'source' must be a valid git URL ` +
            `(SSH: git@host:path or HTTPS: https://host/path)`
        );
      }
      if (isGitHubUrl(repo.source, config.githubHosts)) {
        throw new Error(
          `Repo ${getGitDisplayName(repo.git)}: 'source' cannot be a GitHub URL. ` +
            `Migration from GitHub is not supported. Currently supported sources: Azure DevOps`
        );
      }
    }

    // Validate per-repo file overrides
    if (repo.files) {
      if (typeof repo.files !== "object" || Array.isArray(repo.files)) {
        throw new Error(`Repo at index ${i}: files must be an object`);
      }

      for (const fileName of Object.keys(repo.files)) {
        // Skip reserved key 'inherit'
        if (fileName === "inherit") {
          const inheritValue = (repo.files as Record<string, unknown>).inherit;
          if (typeof inheritValue !== "boolean") {
            throw new Error(
              `Repo at index ${i}: files.inherit must be a boolean`
            );
          }
          continue;
        }

        // Ensure the file is defined at root level
        if (!config.files || !config.files[fileName]) {
          throw new Error(
            `Repo at index ${i} references undefined file '${fileName}'. File must be defined in root 'files' object.`
          );
        }

        const fileOverride = repo.files[fileName];

        // false means exclude this file for this repo - no further validation needed
        if (fileOverride === false) {
          continue;
        }

        if (fileOverride.override && !fileOverride.content) {
          throw new Error(
            `Repo ${getGitDisplayName(repo.git)} has override: true for file '${fileName}' but no content defined. ` +
              `Use content: "" for an empty text file override, or content: {} for an empty JSON/YAML override.`
          );
        }

        // Validate content type
        if (fileOverride.content !== undefined) {
          const hasText = isTextContent(fileOverride.content);
          const hasObject = isObjectContent(fileOverride.content);

          if (!hasText && !hasObject) {
            throw new Error(
              `Repo at index ${i}: file '${fileName}' content must be an object, string, or array of strings`
            );
          }

          // Validate content type matches file extension
          const isStructured = isStructuredFileExtension(fileName);
          if (isStructured && hasText) {
            throw new Error(
              `Repo at index ${i}: file '${fileName}' has JSON/YAML extension but string content. Use object content for structured files.`
            );
          }
          if (!isStructured && hasObject) {
            throw new Error(
              `Repo at index ${i}: file '${fileName}' has text extension but object content. Use string or string[] for text files, or use .json/.yaml/.yml extension.`
            );
          }
        }

        if (
          fileOverride.createOnly !== undefined &&
          typeof fileOverride.createOnly !== "boolean"
        ) {
          throw new Error(
            `Repo ${getGitDisplayName(repo.git)}: file '${fileName}' createOnly must be a boolean`
          );
        }

        if (
          fileOverride.executable !== undefined &&
          typeof fileOverride.executable !== "boolean"
        ) {
          throw new Error(
            `Repo ${getGitDisplayName(repo.git)}: file '${fileName}' executable must be a boolean`
          );
        }

        if (fileOverride.header !== undefined) {
          if (
            typeof fileOverride.header !== "string" &&
            (!Array.isArray(fileOverride.header) ||
              !fileOverride.header.every((h) => typeof h === "string"))
          ) {
            throw new Error(
              `Repo ${getGitDisplayName(repo.git)}: file '${fileName}' header must be a string or array of strings`
            );
          }
        }

        if (
          fileOverride.schemaUrl !== undefined &&
          typeof fileOverride.schemaUrl !== "string"
        ) {
          throw new Error(
            `Repo ${getGitDisplayName(repo.git)}: file '${fileName}' schemaUrl must be a string`
          );
        }

        if (
          fileOverride.template !== undefined &&
          typeof fileOverride.template !== "boolean"
        ) {
          throw new Error(
            `Repo ${getGitDisplayName(repo.git)}: file '${fileName}' template must be a boolean`
          );
        }

        if (fileOverride.vars !== undefined) {
          if (
            typeof fileOverride.vars !== "object" ||
            fileOverride.vars === null ||
            Array.isArray(fileOverride.vars)
          ) {
            throw new Error(
              `Repo ${getGitDisplayName(repo.git)}: file '${fileName}' vars must be an object with string values`
            );
          }
          for (const [key, value] of Object.entries(fileOverride.vars)) {
            if (typeof value !== "string") {
              throw new Error(
                `Repo ${getGitDisplayName(repo.git)}: file '${fileName}' vars.${key} must be a string`
              );
            }
          }
        }

        if (
          fileOverride.deleteOrphaned !== undefined &&
          typeof fileOverride.deleteOrphaned !== "boolean"
        ) {
          throw new Error(
            `Repo ${getGitDisplayName(repo.git)}: file '${fileName}' deleteOrphaned must be a boolean`
          );
        }
      }
    }

    // Validate per-repo settings
    if (repo.settings !== undefined) {
      const rootRulesetNames = config.settings?.rulesets
        ? Object.keys(config.settings.rulesets).filter((k) => k !== "inherit")
        : [];
      const hasRootRepoSettings =
        config.settings?.repo !== undefined && config.settings.repo !== false;
      validateSettings(
        repo.settings,
        `Repo ${getGitDisplayName(repo.git)}`,
        rootRulesetNames,
        hasRootRepoSettings
      );
    }
  }
}

// =============================================================================
// Command-Specific Validators
// =============================================================================

/**
 * Validates that config is suitable for the sync command.
 * @throws Error if files section is missing or empty
 */
export function validateForSync(config: RawConfig): void {
  if (!config.files) {
    throw new Error(
      "The 'sync' command requires a 'files' section with at least one file defined. " +
        "To manage repository settings instead, use 'xfg settings'."
    );
  }

  const fileNames = Object.keys(config.files);
  if (fileNames.length === 0) {
    throw new Error(
      "The 'sync' command requires a 'files' section with at least one file defined. " +
        "To manage repository settings instead, use 'xfg settings'."
    );
  }
}

/**
 * Checks if settings contain actionable configuration.
 * Currently only rulesets, but extensible for future settings features.
 */
export function hasActionableSettings(
  settings: RawRepoSettings | undefined
): boolean {
  if (!settings) return false;

  // Check for rulesets
  if (settings.rulesets && Object.keys(settings.rulesets).length > 0) {
    return true;
  }

  // Check for repo settings
  if (settings.repo && Object.keys(settings.repo).length > 0) {
    return true;
  }

  return false;
}

/**
 * Validates that config is suitable for the settings command.
 * @throws Error if no settings are defined or no actionable settings exist
 */
export function validateForSettings(config: RawConfig): void {
  // Check if settings exist at root or in any repo
  const hasRootSettings = config.settings !== undefined;
  const hasRepoSettings = config.repos.some(
    (repo) => repo.settings !== undefined
  );

  if (!hasRootSettings && !hasRepoSettings) {
    throw new Error(
      "The 'settings' command requires a 'settings' section at root level or " +
        "in at least one repo. To sync files instead, use 'xfg sync'."
    );
  }

  // Check if there's at least one actionable setting
  const rootActionable = hasActionableSettings(config.settings);
  const repoActionable = config.repos.some((repo) =>
    hasActionableSettings(repo.settings)
  );

  if (!rootActionable && !repoActionable) {
    throw new Error(
      "No actionable settings configured. Currently supported: rulesets. " +
        "To sync files instead, use 'xfg sync'. " +
        "See docs: https://anthony-spruyt.github.io/xfg/settings"
    );
  }
}
