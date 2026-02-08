import { extname, isAbsolute } from "node:path";
import type { RawConfig, RawRepoSettings } from "./config.js";

const VALID_STRATEGIES = ["replace", "append", "prepend"];

/**
 * Check if content is text type (string or string[]).
 */
function isTextContent(content: unknown): boolean {
  return (
    typeof content === "string" ||
    (Array.isArray(content) &&
      content.every((item) => typeof item === "string"))
  );
}

/**
 * Check if content is object type (for JSON/YAML output).
 */
function isObjectContent(content: unknown): boolean {
  return (
    typeof content === "object" && content !== null && !Array.isArray(content)
  );
}

/**
 * Check if file extension is for structured output (JSON/YAML).
 */
function isStructuredFileExtension(fileName: string): boolean {
  const ext = extname(fileName).toLowerCase();
  return (
    ext === ".json" || ext === ".json5" || ext === ".yaml" || ext === ".yml"
  );
}

// Pattern for valid config ID: alphanumeric, hyphens, underscores
const CONFIG_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const CONFIG_ID_MAX_LENGTH = 64;

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
      validateSettings(
        repo.settings,
        `Repo ${getGitDisplayName(repo.git)}`,
        rootRulesetNames
      );
    }
  }
}

/**
 * Validates a file name for security issues
 */
function validateFileName(fileName: string): void {
  if (!fileName || typeof fileName !== "string") {
    throw new Error("File name must be a non-empty string");
  }

  // Validate fileName doesn't allow path traversal
  if (fileName.includes("..") || isAbsolute(fileName)) {
    throw new Error(
      `Invalid fileName '${fileName}': must be a relative path without '..' components`
    );
  }

  // Validate fileName doesn't contain control characters that could bypass shell escaping
  if (/[\n\r\0]/.test(fileName)) {
    throw new Error(
      `Invalid fileName '${fileName}': cannot contain newlines or null bytes`
    );
  }
}

function getGitDisplayName(git: string | string[]): string {
  if (Array.isArray(git)) {
    return git[0] || "unknown";
  }
  return git;
}

// =============================================================================
// Repo Settings Validation
// =============================================================================

const VALID_VISIBILITY = ["public", "private", "internal"];
const VALID_SQUASH_MERGE_COMMIT_TITLE = ["PR_TITLE", "COMMIT_OR_PR_TITLE"];
const VALID_SQUASH_MERGE_COMMIT_MESSAGE = [
  "PR_BODY",
  "COMMIT_MESSAGES",
  "BLANK",
];
const VALID_MERGE_COMMIT_TITLE = ["PR_TITLE", "MERGE_MESSAGE"];
const VALID_MERGE_COMMIT_MESSAGE = ["PR_BODY", "PR_TITLE", "BLANK"];

/**
 * Validates GitHub repository settings.
 */
function validateRepoSettings(repo: unknown, context: string): void {
  if (typeof repo !== "object" || repo === null || Array.isArray(repo)) {
    throw new Error(`${context}: repo must be an object`);
  }

  const r = repo as Record<string, unknown>;

  // Validate boolean fields
  const booleanFields = [
    "hasIssues",
    "hasProjects",
    "hasWiki",
    "hasDiscussions",
    "isTemplate",
    "allowForking",
    "archived",
    "allowSquashMerge",
    "allowMergeCommit",
    "allowRebaseMerge",
    "allowAutoMerge",
    "deleteBranchOnMerge",
    "allowUpdateBranch",
    "vulnerabilityAlerts",
    "automatedSecurityFixes",
    "secretScanning",
    "secretScanningPushProtection",
    "privateVulnerabilityReporting",
    "webCommitSignoffRequired",
  ];

  for (const field of booleanFields) {
    if (r[field] !== undefined && typeof r[field] !== "boolean") {
      throw new Error(`${context}: ${field} must be a boolean`);
    }
  }

  // Validate string fields
  if (r.defaultBranch !== undefined && typeof r.defaultBranch !== "string") {
    throw new Error(`${context}: defaultBranch must be a string`);
  }

  // Validate enum fields
  if (
    r.visibility !== undefined &&
    !VALID_VISIBILITY.includes(r.visibility as string)
  ) {
    throw new Error(
      `${context}: visibility must be one of: ${VALID_VISIBILITY.join(", ")}`
    );
  }

  if (
    r.squashMergeCommitTitle !== undefined &&
    !VALID_SQUASH_MERGE_COMMIT_TITLE.includes(
      r.squashMergeCommitTitle as string
    )
  ) {
    throw new Error(
      `${context}: squashMergeCommitTitle must be one of: ${VALID_SQUASH_MERGE_COMMIT_TITLE.join(", ")}`
    );
  }

  if (
    r.squashMergeCommitMessage !== undefined &&
    !VALID_SQUASH_MERGE_COMMIT_MESSAGE.includes(
      r.squashMergeCommitMessage as string
    )
  ) {
    throw new Error(
      `${context}: squashMergeCommitMessage must be one of: ${VALID_SQUASH_MERGE_COMMIT_MESSAGE.join(", ")}`
    );
  }

  if (
    r.mergeCommitTitle !== undefined &&
    !VALID_MERGE_COMMIT_TITLE.includes(r.mergeCommitTitle as string)
  ) {
    throw new Error(
      `${context}: mergeCommitTitle must be one of: ${VALID_MERGE_COMMIT_TITLE.join(", ")}`
    );
  }

  if (
    r.mergeCommitMessage !== undefined &&
    !VALID_MERGE_COMMIT_MESSAGE.includes(r.mergeCommitMessage as string)
  ) {
    throw new Error(
      `${context}: mergeCommitMessage must be one of: ${VALID_MERGE_COMMIT_MESSAGE.join(", ")}`
    );
  }
}

// =============================================================================
// Ruleset Validation
// =============================================================================

const VALID_RULESET_TARGETS = ["branch", "tag"];
const VALID_ENFORCEMENT_LEVELS = ["active", "disabled", "evaluate"];
const VALID_ACTOR_TYPES = ["Team", "User", "Integration"];
const VALID_BYPASS_MODES = ["always", "pull_request"];
const VALID_PATTERN_OPERATORS = [
  "starts_with",
  "ends_with",
  "contains",
  "regex",
];
const VALID_MERGE_METHODS = ["merge", "squash", "rebase"];
const VALID_ALERTS_THRESHOLDS = [
  "none",
  "errors",
  "errors_and_warnings",
  "all",
];
const VALID_SECURITY_THRESHOLDS = [
  "none",
  "critical",
  "high_or_higher",
  "medium_or_higher",
  "all",
];

const VALID_RULE_TYPES = [
  "pull_request",
  "required_status_checks",
  "required_signatures",
  "required_linear_history",
  "non_fast_forward",
  "creation",
  "update",
  "deletion",
  "required_deployments",
  "code_scanning",
  "code_quality",
  "workflows",
  "commit_author_email_pattern",
  "commit_message_pattern",
  "committer_email_pattern",
  "branch_name_pattern",
  "tag_name_pattern",
  "file_path_restriction",
  "file_extension_restriction",
  "max_file_path_length",
  "max_file_size",
];

/**
 * Validates a single ruleset rule.
 */
function validateRule(rule: unknown, context: string): void {
  if (typeof rule !== "object" || rule === null || Array.isArray(rule)) {
    throw new Error(`${context}: rule must be an object`);
  }

  const r = rule as Record<string, unknown>;

  if (!r.type || typeof r.type !== "string") {
    throw new Error(`${context}: rule must have a 'type' string field`);
  }

  if (!VALID_RULE_TYPES.includes(r.type)) {
    throw new Error(
      `${context}: invalid rule type '${r.type}'. Must be one of: ${VALID_RULE_TYPES.join(", ")}`
    );
  }

  // Validate parameters based on rule type
  if (r.parameters !== undefined) {
    if (
      typeof r.parameters !== "object" ||
      r.parameters === null ||
      Array.isArray(r.parameters)
    ) {
      throw new Error(`${context}: rule parameters must be an object`);
    }

    const params = r.parameters as Record<string, unknown>;

    // Validate pattern rule parameters
    if (r.type.toString().endsWith("_pattern")) {
      if (
        params.operator !== undefined &&
        !VALID_PATTERN_OPERATORS.includes(params.operator as string)
      ) {
        throw new Error(
          `${context}: pattern rule operator must be one of: ${VALID_PATTERN_OPERATORS.join(", ")}`
        );
      }
      if (params.pattern !== undefined && typeof params.pattern !== "string") {
        throw new Error(`${context}: pattern rule pattern must be a string`);
      }
    }

    // Validate pull_request parameters
    if (r.type === "pull_request") {
      if (params.requiredApprovingReviewCount !== undefined) {
        const count = params.requiredApprovingReviewCount;
        if (
          typeof count !== "number" ||
          !Number.isInteger(count) ||
          count < 0 ||
          count > 10
        ) {
          throw new Error(
            `${context}: requiredApprovingReviewCount must be an integer between 0 and 10`
          );
        }
      }
      if (params.allowedMergeMethods !== undefined) {
        if (!Array.isArray(params.allowedMergeMethods)) {
          throw new Error(`${context}: allowedMergeMethods must be an array`);
        }
        for (const method of params.allowedMergeMethods) {
          if (!VALID_MERGE_METHODS.includes(method as string)) {
            throw new Error(
              `${context}: allowedMergeMethods values must be one of: ${VALID_MERGE_METHODS.join(", ")}`
            );
          }
        }
      }
    }

    // Validate code_scanning parameters
    if (r.type === "code_scanning" && params.codeScanningTools !== undefined) {
      if (!Array.isArray(params.codeScanningTools)) {
        throw new Error(`${context}: codeScanningTools must be an array`);
      }
      for (const tool of params.codeScanningTools) {
        if (typeof tool !== "object" || tool === null) {
          throw new Error(
            `${context}: each codeScanningTool must be an object`
          );
        }
        const t = tool as Record<string, unknown>;
        if (
          t.alertsThreshold !== undefined &&
          !VALID_ALERTS_THRESHOLDS.includes(t.alertsThreshold as string)
        ) {
          throw new Error(
            `${context}: alertsThreshold must be one of: ${VALID_ALERTS_THRESHOLDS.join(", ")}`
          );
        }
        if (
          t.securityAlertsThreshold !== undefined &&
          !VALID_SECURITY_THRESHOLDS.includes(
            t.securityAlertsThreshold as string
          )
        ) {
          throw new Error(
            `${context}: securityAlertsThreshold must be one of: ${VALID_SECURITY_THRESHOLDS.join(", ")}`
          );
        }
      }
    }
  }
}

/**
 * Validates a single ruleset.
 */
function validateRuleset(
  ruleset: unknown,
  name: string,
  context: string
): void {
  if (
    typeof ruleset !== "object" ||
    ruleset === null ||
    Array.isArray(ruleset)
  ) {
    throw new Error(`${context}: ruleset '${name}' must be an object`);
  }

  const rs = ruleset as Record<string, unknown>;

  if (
    rs.target !== undefined &&
    !VALID_RULESET_TARGETS.includes(rs.target as string)
  ) {
    throw new Error(
      `${context}: ruleset '${name}' target must be one of: ${VALID_RULESET_TARGETS.join(", ")}`
    );
  }

  if (
    rs.enforcement !== undefined &&
    !VALID_ENFORCEMENT_LEVELS.includes(rs.enforcement as string)
  ) {
    throw new Error(
      `${context}: ruleset '${name}' enforcement must be one of: ${VALID_ENFORCEMENT_LEVELS.join(", ")}`
    );
  }

  // Validate bypassActors
  if (rs.bypassActors !== undefined) {
    if (!Array.isArray(rs.bypassActors)) {
      throw new Error(
        `${context}: ruleset '${name}' bypassActors must be an array`
      );
    }
    for (let i = 0; i < rs.bypassActors.length; i++) {
      const actor = rs.bypassActors[i] as Record<string, unknown>;
      if (typeof actor !== "object" || actor === null) {
        throw new Error(
          `${context}: ruleset '${name}' bypassActors[${i}] must be an object`
        );
      }
      if (typeof actor.actorId !== "number") {
        throw new Error(
          `${context}: ruleset '${name}' bypassActors[${i}].actorId must be a number`
        );
      }
      if (!VALID_ACTOR_TYPES.includes(actor.actorType as string)) {
        throw new Error(
          `${context}: ruleset '${name}' bypassActors[${i}].actorType must be one of: ${VALID_ACTOR_TYPES.join(", ")}`
        );
      }
      if (
        actor.bypassMode !== undefined &&
        !VALID_BYPASS_MODES.includes(actor.bypassMode as string)
      ) {
        throw new Error(
          `${context}: ruleset '${name}' bypassActors[${i}].bypassMode must be one of: ${VALID_BYPASS_MODES.join(", ")}`
        );
      }
    }
  }

  // Validate conditions
  if (rs.conditions !== undefined) {
    if (
      typeof rs.conditions !== "object" ||
      rs.conditions === null ||
      Array.isArray(rs.conditions)
    ) {
      throw new Error(
        `${context}: ruleset '${name}' conditions must be an object`
      );
    }
    const conditions = rs.conditions as Record<string, unknown>;
    if (conditions.refName !== undefined) {
      const refName = conditions.refName as Record<string, unknown>;
      if (
        typeof refName !== "object" ||
        refName === null ||
        Array.isArray(refName)
      ) {
        throw new Error(
          `${context}: ruleset '${name}' conditions.refName must be an object`
        );
      }
      if (
        refName.include !== undefined &&
        (!Array.isArray(refName.include) ||
          !refName.include.every((s) => typeof s === "string"))
      ) {
        throw new Error(
          `${context}: ruleset '${name}' conditions.refName.include must be an array of strings`
        );
      }
      if (
        refName.exclude !== undefined &&
        (!Array.isArray(refName.exclude) ||
          !refName.exclude.every((s) => typeof s === "string"))
      ) {
        throw new Error(
          `${context}: ruleset '${name}' conditions.refName.exclude must be an array of strings`
        );
      }
    }
  }

  // Validate rules array
  if (rs.rules !== undefined) {
    if (!Array.isArray(rs.rules)) {
      throw new Error(`${context}: ruleset '${name}' rules must be an array`);
    }
    for (let i = 0; i < rs.rules.length; i++) {
      validateRule(rs.rules[i], `${context}: ruleset '${name}' rules[${i}]`);
    }
  }
}

/**
 * Validates settings object containing rulesets.
 */
export function validateSettings(
  settings: unknown,
  context: string,
  rootRulesetNames?: string[]
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
    validateRepoSettings(s.repo, context);
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
