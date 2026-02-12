import type { GitHubRepoSettings } from "../../config/index.js";
import type { CurrentRepoSettings } from "./types.js";

export type RepoSettingsAction = "add" | "change" | "unchanged";

export interface RepoSettingsChange {
  property: keyof GitHubRepoSettings;
  action: RepoSettingsAction;
  oldValue?: unknown;
  newValue?: unknown;
}

/**
 * Maps config property names (camelCase) to GitHub API property names (snake_case).
 */
const PROPERTY_MAPPING: Record<keyof GitHubRepoSettings, string> = {
  description: "description",
  hasIssues: "has_issues",
  hasProjects: "has_projects",
  hasWiki: "has_wiki",
  hasDiscussions: "has_discussions",
  isTemplate: "is_template",
  allowForking: "allow_forking",
  visibility: "visibility",
  archived: "archived",
  allowSquashMerge: "allow_squash_merge",
  allowMergeCommit: "allow_merge_commit",
  allowRebaseMerge: "allow_rebase_merge",
  allowAutoMerge: "allow_auto_merge",
  deleteBranchOnMerge: "delete_branch_on_merge",
  allowUpdateBranch: "allow_update_branch",
  squashMergeCommitTitle: "squash_merge_commit_title",
  squashMergeCommitMessage: "squash_merge_commit_message",
  mergeCommitTitle: "merge_commit_title",
  mergeCommitMessage: "merge_commit_message",
  webCommitSignoffRequired: "web_commit_signoff_required",
  defaultBranch: "default_branch",
  vulnerabilityAlerts: "vulnerability_alerts",
  automatedSecurityFixes: "automated_security_fixes",
  secretScanning: "_secret_scanning",
  secretScanningPushProtection: "_secret_scanning_push_protection",
  privateVulnerabilityReporting: "private_vulnerability_reporting",
};

/**
 * Gets the current value for a property from GitHub API response.
 */
function getCurrentValue(
  current: CurrentRepoSettings,
  property: keyof GitHubRepoSettings
): unknown {
  const apiKey = PROPERTY_MAPPING[property];

  // Handle security_and_analysis nested properties
  if (apiKey === "_secret_scanning") {
    return current.security_and_analysis?.secret_scanning?.status === "enabled";
  }
  if (apiKey === "_secret_scanning_push_protection") {
    return (
      current.security_and_analysis?.secret_scanning_push_protection?.status ===
      "enabled"
    );
  }

  // These require separate API calls to check, return undefined
  if (apiKey.startsWith("_")) {
    return undefined;
  }

  return (current as Record<string, unknown>)[apiKey];
}

/**
 * Compares current repository settings with desired settings.
 * Only compares properties that are explicitly set in desired.
 */
export function diffRepoSettings(
  current: CurrentRepoSettings,
  desired: GitHubRepoSettings
): RepoSettingsChange[] {
  const changes: RepoSettingsChange[] = [];

  for (const [key, desiredValue] of Object.entries(desired)) {
    if (desiredValue === undefined) continue;

    const property = key as keyof GitHubRepoSettings;
    const currentValue = getCurrentValue(current, property);

    if (currentValue === undefined) {
      // Property not currently set or unknown
      changes.push({
        property,
        action: "add",
        newValue: desiredValue,
      });
    } else if (currentValue !== desiredValue) {
      changes.push({
        property,
        action: "change",
        oldValue: currentValue,
        newValue: desiredValue,
      });
    }
    // unchanged properties are not included
  }

  return changes;
}

/**
 * Checks if there are any changes to apply.
 */
export function hasChanges(changes: RepoSettingsChange[]): boolean {
  return changes.some((c) => c.action !== "unchanged");
}
