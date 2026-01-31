import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { parse } from "yaml";
import type { ArrayMergeStrategy } from "./merge.js";
import { validateRawConfig } from "./config-validator.js";
import { normalizeConfig } from "./config-normalizer.js";
import { resolveFileReferencesInConfig } from "./file-reference-resolver.js";

// Re-export formatter functions for backwards compatibility
export { convertContentToString } from "./config-formatter.js";

// =============================================================================
// PR Merge Options Types
// =============================================================================

export type MergeMode = "manual" | "auto" | "force" | "direct";
export type MergeStrategy = "merge" | "squash" | "rebase";

export interface PRMergeOptions {
  merge?: MergeMode;
  mergeStrategy?: MergeStrategy;
  deleteBranch?: boolean;
  bypassReason?: string;
}

// =============================================================================
// Branch Protection Types (aligned with GitHub REST API)
// =============================================================================

/**
 * A single status check requirement.
 * @see https://docs.github.com/en/rest/branches/branch-protection
 */
export interface StatusCheck {
  /** The name of the required check */
  context: string;
  /** The ID of the GitHub App that must provide this check. Omit to auto-select. */
  appId?: number;
}

/**
 * Required status checks configuration.
 */
export interface RequiredStatusChecks {
  /** Require branches to be up to date before merging */
  strict?: boolean;
  /** List of status checks (preferred over contexts) */
  checks?: StatusCheck[];
  /** @deprecated Use checks instead. List of status check context names. */
  contexts?: string[];
}

/**
 * Actor restrictions - specifies users, teams, and apps.
 * Used for dismissal_restrictions, restrictions, and bypass_pull_request_allowances.
 */
export interface ActorRestrictions {
  /** List of user logins */
  users?: string[];
  /** List of team slugs */
  teams?: string[];
  /** List of app slugs */
  apps?: string[];
}

/**
 * Branch protection rule configuration.
 * All fields are optional - only specify what you want to enforce.
 * @see https://docs.github.com/en/rest/branches/branch-protection
 */
export interface BranchProtectionRule {
  // ==========================================================================
  // Required Pull Request Reviews
  // ==========================================================================

  /** Number of required approving reviews (0-6). 0 means no reviews required. */
  requiredReviews?: number;
  /** Automatically dismiss approving reviews when new commits are pushed */
  dismissStaleReviews?: boolean;
  /** Require review from code owners */
  requireCodeOwners?: boolean;
  /** Require approval from someone other than the last pusher */
  requireLastPushApproval?: boolean;
  /** Users/teams/apps who can dismiss reviews (org repos only) */
  dismissalRestrictions?: ActorRestrictions;
  /** Users/teams/apps who can bypass PR requirements */
  bypassPullRequestAllowances?: ActorRestrictions;

  // ==========================================================================
  // Required Status Checks
  // ==========================================================================

  /** Status checks that must pass before merging */
  requiredStatusChecks?: RequiredStatusChecks;

  // ==========================================================================
  // Push Restrictions
  // ==========================================================================

  /** Enforce all restrictions for administrators */
  enforceAdmins?: boolean;
  /** Users/teams/apps who can push to the branch (org repos only) */
  restrictions?: ActorRestrictions;

  // ==========================================================================
  // Branch Settings
  // ==========================================================================

  /** Enforce linear commit history (no merge commits) */
  requiredLinearHistory?: boolean;
  /** Allow force pushes */
  allowForcePushes?: boolean;
  /** Allow branch deletion */
  allowDeletions?: boolean;
  /** Block new branch creation that matches this pattern */
  blockCreations?: boolean;
  /** Require conversation resolution before merging */
  requiredConversationResolution?: boolean;
  /** Lock the branch (make it read-only) */
  lockBranch?: boolean;
  /** Allow fork syncing (for forks to pull upstream changes) */
  allowForkSyncing?: boolean;

  // ==========================================================================
  // Commit Signatures
  // ==========================================================================

  /** Require signed commits */
  requiredSignatures?: boolean;
}

export interface RepoSettings {
  branchProtection?: Record<string, BranchProtectionRule>;
  deleteOrphaned?: boolean;
}

// =============================================================================
// Raw Config Types (as parsed from YAML)
// =============================================================================

// Content can be object (JSON/YAML), string (text), or string[] (text lines)
export type ContentValue = Record<string, unknown> | string | string[];

// Per-file configuration at root level
export interface RawFileConfig {
  content?: ContentValue;
  mergeStrategy?: ArrayMergeStrategy;
  createOnly?: boolean;
  executable?: boolean;
  header?: string | string[];
  schemaUrl?: string;
  template?: boolean;
  vars?: Record<string, string>;
  deleteOrphaned?: boolean;
}

// Per-repo file override
export interface RawRepoFileOverride {
  content?: ContentValue;
  override?: boolean;
  createOnly?: boolean;
  executable?: boolean;
  header?: string | string[];
  schemaUrl?: string;
  template?: boolean;
  vars?: Record<string, string>;
  deleteOrphaned?: boolean;
}

// Raw settings (before normalization)
export interface RawRepoSettings {
  branchProtection?: Record<string, BranchProtectionRule>;
  deleteOrphaned?: boolean;
}

// Repo configuration
// files can map to false to exclude, or an object to override
export interface RawRepoConfig {
  git: string | string[];
  files?: Record<string, RawRepoFileOverride | false>;
  prOptions?: PRMergeOptions;
  settings?: RawRepoSettings;
}

// Root config structure
export interface RawConfig {
  id: string;
  files: Record<string, RawFileConfig>;
  repos: RawRepoConfig[];
  prOptions?: PRMergeOptions;
  prTemplate?: string;
  githubHosts?: string[];
  deleteOrphaned?: boolean;
  settings?: RawRepoSettings;
}

// =============================================================================
// Normalized Config Types (output)
// =============================================================================

// File content for a single file in a repo
export interface FileContent {
  fileName: string;
  content: ContentValue | null;
  createOnly?: boolean;
  executable?: boolean;
  header?: string[];
  schemaUrl?: string;
  template?: boolean;
  vars?: Record<string, string>;
  deleteOrphaned?: boolean;
}

// Normalized repo config with all files to sync
export interface RepoConfig {
  git: string;
  files: FileContent[];
  prOptions?: PRMergeOptions;
  settings?: RepoSettings;
}

// Normalized config
export interface Config {
  id: string;
  repos: RepoConfig[];
  prTemplate?: string;
  githubHosts?: string[];
  deleteOrphaned?: boolean;
  settings?: RepoSettings;
}

// =============================================================================
// Public API
// =============================================================================

export function loadConfig(filePath: string): Config {
  const content = readFileSync(filePath, "utf-8");
  const configDir = dirname(filePath);

  let rawConfig: RawConfig;
  try {
    rawConfig = parse(content) as RawConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse YAML config at ${filePath}: ${message}`);
  }

  // Resolve file references before validation so content type checking works
  rawConfig = resolveFileReferencesInConfig(rawConfig, { configDir });

  validateRawConfig(rawConfig);

  return normalizeConfig(rawConfig);
}
