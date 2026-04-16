import type { RepoInfo } from "../../repo/detector.js";
import type {
  GitHubRepoSettings,
  RepoVisibility,
  SquashMergeCommitTitle,
  SquashMergeCommitMessage,
  MergeCommitTitle,
  MergeCommitMessage,
} from "../../config/index.js";
import type { GhApiOptions } from "../../shared/gh-api-utils.js";

/**
 * Current repository settings from GitHub API (snake_case).
 */
export interface CurrentRepoSettings {
  description?: string;
  has_issues?: boolean;
  has_projects?: boolean;
  has_wiki?: boolean;
  has_discussions?: boolean;
  is_template?: boolean;
  allow_forking?: boolean;
  visibility?: RepoVisibility;
  archived?: boolean;
  allow_squash_merge?: boolean;
  allow_merge_commit?: boolean;
  allow_rebase_merge?: boolean;
  allow_auto_merge?: boolean;
  delete_branch_on_merge?: boolean;
  allow_update_branch?: boolean;
  squash_merge_commit_title?: SquashMergeCommitTitle;
  squash_merge_commit_message?: SquashMergeCommitMessage;
  merge_commit_title?: MergeCommitTitle;
  merge_commit_message?: MergeCommitMessage;
  web_commit_signoff_required?: boolean;
  default_branch?: string;
  security_and_analysis?: {
    secret_scanning?: { status: "enabled" | "disabled" };
    secret_scanning_push_protection?: { status: "enabled" | "disabled" };
    secret_scanning_validity_checks?: { status: "enabled" | "disabled" };
  };
  owner_type?: "User" | "Organization";
  vulnerability_alerts?: boolean;
  automated_security_fixes?: boolean;
  private_vulnerability_reporting?: boolean;
}

export interface IRepoSettingsStrategy {
  /**
   * Gets current repository settings.
   */
  getSettings(
    repoInfo: RepoInfo,
    options?: GhApiOptions
  ): Promise<CurrentRepoSettings>;

  /**
   * Updates repository settings.
   */
  updateSettings(
    repoInfo: RepoInfo,
    settings: GitHubRepoSettings,
    options?: GhApiOptions
  ): Promise<void>;

  /**
   * Enables or disables vulnerability alerts.
   */
  setVulnerabilityAlerts(
    repoInfo: RepoInfo,
    enable: boolean,
    options?: GhApiOptions
  ): Promise<void>;

  /**
   * Enables or disables automated security fixes.
   */
  setAutomatedSecurityFixes(
    repoInfo: RepoInfo,
    enable: boolean,
    options?: GhApiOptions
  ): Promise<void>;

  /**
   * Enables or disables private vulnerability reporting.
   */
  setPrivateVulnerabilityReporting(
    repoInfo: RepoInfo,
    enable: boolean,
    options?: GhApiOptions
  ): Promise<void>;

  /**
   * Checks whether a branch exists in the repository.
   */
  branchExists(
    repoInfo: RepoInfo,
    branch: string,
    options?: GhApiOptions
  ): Promise<boolean>;
}
