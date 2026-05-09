import type { RawConfig } from "../types.js";
import { expandRepoGroups } from "../extends-resolver.js";
import { validateFileName } from "./file-validator.js";
import { isPlainObject } from "../../shared/type-guards.js";
import { escapeRegExp } from "../../shared/shell-utils.js";
import { ValidationError } from "../../shared/errors.js";
import {
  validateFileConfigFields,
  validateSettings,
  buildRootSettingsContext,
  enrichSettingsContext,
} from "./shared.js";

function isValidGitUrl(url: string): boolean {
  return /^git@[^:]+:.+$/.test(url) || /^https?:\/\/[^/]+\/.+$/.test(url);
}

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
    return git.length > 0 ? git[0] : "(empty git array)";
  }
  return git;
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
        for (const fileName of Object.keys(group.files)) {
          if (fileName !== "inherit") knownFiles.add(fileName);
        }
      }
    }
  }
  if (config.conditionalGroups) {
    for (const cg of config.conditionalGroups) {
      if (cg.files) {
        for (const fileName of Object.keys(cg.files)) {
          if (fileName !== "inherit") knownFiles.add(fileName);
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
      const fileEntry = (repo.files as Record<string, unknown>)[fileName];
      const isStandaloneDefinition =
        fileEntry != null &&
        fileEntry !== false &&
        typeof fileEntry === "object" &&
        "content" in (fileEntry as Record<string, unknown>) &&
        (fileEntry as Record<string, unknown>).content !== undefined &&
        (fileEntry as Record<string, unknown>).content !== null;
      if (!isStandaloneDefinition) {
        throw new ValidationError(
          `Repo at index ${index} references undefined file '${fileName}'. File must be defined in root 'files' object or in a referenced group, or provide content inline.`
        );
      }
      validateFileName(fileName);
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
      enrichSettingsContext(rootCtx, config.groups[groupName]?.settings);
    }
  }
  if (config.conditionalGroups) {
    for (const cg of config.conditionalGroups) {
      enrichSettingsContext(rootCtx, cg.settings);
    }
  }

  validateSettings(repo.settings, `Repo ${repoLabel}`, rootCtx);
}

export function validateRepoEntry(
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
