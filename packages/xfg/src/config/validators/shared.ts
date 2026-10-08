import type { RawConfig, RawRootSettings, RawRepoSettings } from "../types.js";
import {
  isTextContent,
  isObjectContent,
  isStructuredFileExtension,
  validValues,
  VALID_STRATEGIES,
} from "./file-validator.js";
import { validateRuleset } from "./ruleset-validator.js";
import { validateRepoSettings } from "./repo-settings-validator.js";
import { isPlainObject } from "../../shared/type-guards.js";
import { ValidationError } from "../../shared/errors.js";
import type {
  CodeScanningState,
  CodeScanningQuerySuite,
  CodeScanningLanguage,
} from "../types.js";

export interface RootSettingsContext {
  rulesetNames: string[];
  hasRepoSettings: boolean;
  hasCodeScanningSettings: boolean;
  labelNames: string[];
}

export function buildRootSettingsContext(
  config: RawConfig
): RootSettingsContext {
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

export function validateFileConfigFields(
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

const VALID_CODE_SCANNING_STATES = validValues<CodeScanningState>([
  "configured",
  "not-configured",
]);
const VALID_CODE_SCANNING_QUERY_SUITES = validValues<CodeScanningQuerySuite>([
  "default",
  "extended",
]);
const VALID_CODE_SCANNING_LANGUAGES = validValues<CodeScanningLanguage>([
  "actions",
  "c-cpp",
  "csharp",
  "go",
  "java-kotlin",
  "javascript-typescript",
  "python",
  "ruby",
  "swift",
]);

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

function validateSettingsRulesets(
  settings: Record<string, unknown>,
  context: string,
  rootCtx?: RootSettingsContext
): void {
  if (settings.rulesets === undefined) return;
  if (!isPlainObject(settings.rulesets)) {
    throw new ValidationError(`${context}: rulesets must be an object`);
  }

  const rulesets = settings.rulesets;
  for (const [name, ruleset] of Object.entries(rulesets)) {
    if (name === "inherit") continue;

    if (ruleset === false) {
      if (rootCtx && !rootCtx.rulesetNames.includes(name)) {
        throw new ValidationError(
          `${context}: Cannot opt out of '${name}' - not defined in root settings.rulesets`
        );
      }
      continue;
    }

    validateRuleset(ruleset, name, context);
  }
}

function validateSettingsLabels(
  settings: Record<string, unknown>,
  context: string,
  rootCtx?: RootSettingsContext
): void {
  if (settings.labels === undefined) return;
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

function validateSettingsDeleteOrphaned(
  settings: Record<string, unknown>,
  context: string
): void {
  if (
    settings.deleteOrphaned !== undefined &&
    typeof settings.deleteOrphaned !== "boolean"
  ) {
    throw new ValidationError(
      `${context}: settings.deleteOrphaned must be a boolean`
    );
  }
}

function validateSettingsRepo(
  settings: Record<string, unknown>,
  context: string,
  rootCtx?: RootSettingsContext
): void {
  if (settings.repo === undefined) return;
  if (settings.repo === false) {
    if (!rootCtx) {
      throw new ValidationError(
        `${context}: repo: false is not valid at root level. Define repo settings or remove the field.`
      );
    }
    if (!rootCtx.hasRepoSettings) {
      throw new ValidationError(
        `${context}: Cannot opt out of repo settings — not defined in root settings.repo`
      );
    }
    return;
  }
  validateRepoSettings(settings.repo, context);
}

function validateSettingsCodeScanning(
  settings: Record<string, unknown>,
  context: string,
  rootCtx?: RootSettingsContext
): void {
  if (settings.codeScanning === undefined) return;
  if (settings.codeScanning === false) {
    if (!rootCtx) {
      throw new ValidationError(
        `${context}: codeScanning: false is not valid at root level. Define codeScanning settings or remove the field.`
      );
    }
    if (!rootCtx.hasCodeScanningSettings) {
      throw new ValidationError(
        `${context}: Cannot opt out of code scanning settings — not defined in root settings.codeScanning`
      );
    }
    return;
  }
  validateCodeScanningSettings(
    settings.codeScanning,
    `${context} codeScanning`
  );
}

function validateSettingsSecrets(
  settings: RawRepoSettings | RawRootSettings,
  context: string
): void {
  if (settings.secrets === undefined) return;

  if (!isPlainObject(settings.secrets)) {
    throw new ValidationError(`${context}: settings.secrets must be an object`);
  }

  for (const [name, value] of Object.entries(settings.secrets)) {
    if (name === "deleteOrphaned" || name === "inherit") {
      if (value !== undefined && typeof value !== "boolean") {
        throw new ValidationError(
          `${context}: settings.secrets.${name} must be a boolean`
        );
      }
      continue;
    }
    if (value === false) continue;
    if (!isPlainObject(value)) {
      throw new ValidationError(
        `${context}: secret '${name}' must be an object with an 'env' field, or false to opt out`
      );
    }
  }
}

const GITHUB_USERNAME_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const COLLABORATORS_KEYS = new Set(["users", "deleteOrphaned", "inherit"]);

function validateSettingsCollaborators(
  settings: RawRepoSettings | RawRootSettings,
  context: string
): void {
  if (settings.collaborators === undefined) return;

  if (!isPlainObject(settings.collaborators)) {
    throw new ValidationError(`${context}: collaborators must be an object`);
  }

  const collaborators = settings.collaborators as Record<string, unknown>;
  for (const key of Object.keys(collaborators)) {
    if (!COLLABORATORS_KEYS.has(key)) {
      throw new ValidationError(
        `${context}: collaborators: unknown key '${key}'`
      );
    }
  }

  for (const key of ["deleteOrphaned", "inherit"]) {
    const value = collaborators[key];
    if (value !== undefined && typeof value !== "boolean") {
      throw new ValidationError(
        `${context}: collaborators.${key} must be a boolean`
      );
    }
  }

  const users = collaborators.users;
  if (users === undefined) return;
  if (!Array.isArray(users)) {
    throw new ValidationError(
      `${context}: collaborators.users must be an array of GitHub usernames`
    );
  }
  for (const user of users) {
    if (typeof user !== "string" || !GITHUB_USERNAME_PATTERN.test(user)) {
      throw new ValidationError(
        `${context}: collaborators.users entry '${String(user)}' is not a valid GitHub username`
      );
    }
  }
}

const ENVIRONMENT_KEYS = new Set(["deploymentBranchPolicy", "secrets"]);
const BRANCH_POLICY_KEYS = new Set(["protectedBranches", "custom"]);
const BRANCH_PATTERN_KEYS = new Set(["type", "name"]);
const ENVIRONMENT_NAME_MAX_LENGTH = 255;

function assertKnownKeys(
  obj: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  context: string
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new ValidationError(`${context}: unknown key '${key}'`);
    }
  }
}

function validateBranchPatterns(custom: unknown, context: string): void {
  if (!Array.isArray(custom) || custom.length === 0) {
    throw new ValidationError(`${context}: custom must be a non-empty array`);
  }
  const seen = new Set<string>();
  custom.forEach((pattern: unknown, i) => {
    const ctx = `${context}: custom[${i}]`;
    if (!isPlainObject(pattern)) {
      throw new ValidationError(`${ctx} must be an object`);
    }
    assertKnownKeys(pattern, BRANCH_PATTERN_KEYS, ctx);
    if (pattern.type !== "branch" && pattern.type !== "tag") {
      throw new ValidationError(`${ctx}.type must be 'branch' or 'tag'`);
    }
    if (typeof pattern.name !== "string" || pattern.name.trim() === "") {
      throw new ValidationError(`${ctx}.name must be a non-empty string`);
    }
    const key = `${pattern.type}\u0000${pattern.name}`;
    if (seen.has(key)) {
      throw new ValidationError(
        `${context}: duplicate pattern ${pattern.type} '${pattern.name}'`
      );
    }
    seen.add(key);
  });
}

function validateDeploymentBranchPolicy(
  policy: unknown,
  context: string,
  isRoot: boolean
): void {
  const ctx = `${context} deploymentBranchPolicy`;
  if (policy === false) {
    if (isRoot) {
      throw new ValidationError(
        `${context}: deploymentBranchPolicy: false is not valid at root level. Omit it to let any branch deploy.`
      );
    }
    return;
  }
  if (!isPlainObject(policy)) {
    throw new ValidationError(`${ctx} must be an object`);
  }
  assertKnownKeys(policy, BRANCH_POLICY_KEYS, `${context}: deploymentBranchPolicy`);

  const hasProtected = policy.protectedBranches !== undefined;
  const hasCustom = policy.custom !== undefined;
  if (hasProtected === hasCustom) {
    throw new ValidationError(
      `${ctx} needs exactly one of 'protectedBranches: true' or 'custom'`
    );
  }
  if (hasProtected && policy.protectedBranches !== true) {
    throw new ValidationError(
      `${ctx}: protectedBranches must be true. Omit deploymentBranchPolicy to let any branch deploy.`
    );
  }
  if (hasCustom) {
    validateBranchPatterns(policy.custom, ctx);
  }
}

function validateEnvironmentSecrets(secrets: unknown, context: string): void {
  if (!isPlainObject(secrets)) {
    throw new ValidationError(`${context}: secrets must be an object`);
  }
  for (const [name, value] of Object.entries(secrets)) {
    if (name === "deleteOrphaned" || name === "inherit") {
      throw new ValidationError(
        `${context}: '${name}' is not supported in environment secrets`
      );
    }
    if (value === false) continue;
    if (!isPlainObject(value)) {
      throw new ValidationError(
        `${context}: secret '${name}' must be an object with an 'env' field, or false to opt out`
      );
    }
  }
}

function validateSettingsEnvironments(
  settings: RawRepoSettings | RawRootSettings,
  context: string,
  rootCtx?: RootSettingsContext
): void {
  if (settings.environments === undefined) return;

  if (!isPlainObject(settings.environments)) {
    throw new ValidationError(`${context}: environments must be an object`);
  }

  for (const [name, env] of Object.entries(settings.environments)) {
    if (name === "inherit") {
      if (typeof env !== "boolean") {
        throw new ValidationError(
          `${context}: environments.inherit must be a boolean`
        );
      }
      continue;
    }
    if (name.trim() === "") {
      throw new ValidationError(
        `${context}: environment name must not be blank`
      );
    }
    if (name.length > ENVIRONMENT_NAME_MAX_LENGTH) {
      throw new ValidationError(
        `${context}: environment name '${name.slice(0, 40)}...' exceeds ${ENVIRONMENT_NAME_MAX_LENGTH} characters`
      );
    }
    if (env === false) continue;

    const envCtx = `${context}: environment '${name}'`;
    if (!isPlainObject(env)) {
      throw new ValidationError(
        `${envCtx} must be an object, or false to opt out`
      );
    }
    assertKnownKeys(env, ENVIRONMENT_KEYS, envCtx);
    if (env.deploymentBranchPolicy !== undefined) {
      validateDeploymentBranchPolicy(env.deploymentBranchPolicy, envCtx, !rootCtx);
    }
    if (env.secrets !== undefined) {
      validateEnvironmentSecrets(env.secrets, envCtx);
    }
  }
}

export function validateSettings(
  settings: unknown,
  context: string,
  rootCtx?: RootSettingsContext
): void {
  if (!isPlainObject(settings)) {
    throw new ValidationError(`${context}: settings must be an object`);
  }

  validateSettingsRulesets(settings, context, rootCtx);
  validateSettingsLabels(settings, context, rootCtx);
  validateSettingsDeleteOrphaned(settings, context);
  validateSettingsRepo(settings, context, rootCtx);
  validateSettingsCodeScanning(settings, context, rootCtx);
  validateSettingsSecrets(settings, context);
  validateSettingsCollaborators(settings, context);
  validateSettingsEnvironments(settings, context, rootCtx);
}

export function enrichSettingsContext(
  rootCtx: RootSettingsContext,
  settings: RawRepoSettings | RawRootSettings | undefined
): void {
  if (!settings) return;
  if (settings.rulesets) {
    for (const name of Object.keys(settings.rulesets)) {
      if (name !== "inherit") rootCtx.rulesetNames.push(name);
    }
  }
  if (settings.labels) {
    for (const name of Object.keys(settings.labels)) {
      if (name !== "inherit") rootCtx.labelNames.push(name);
    }
  }
  if (settings.repo !== undefined && settings.repo !== false) {
    rootCtx.hasRepoSettings = true;
  }
  if (settings.codeScanning !== undefined && settings.codeScanning !== false) {
    rootCtx.hasCodeScanningSettings = true;
  }
}
