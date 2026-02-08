import type { RepoInfo } from "../repo-detector.js";
import type { GitHubRepoSettings } from "../config.js";

export interface RepoSettingsStrategyOptions {
  token?: string;
  host?: string;
}

/**
 * Current repository settings from GitHub API (snake_case).
 */
export interface CurrentRepoSettings {
  has_issues?: boolean;
  has_projects?: boolean;
  has_wiki?: boolean;
  has_discussions?: boolean;
  is_template?: boolean;
  allow_forking?: boolean;
  visibility?: string;
  archived?: boolean;
  allow_squash_merge?: boolean;
  allow_merge_commit?: boolean;
  allow_rebase_merge?: boolean;
  allow_auto_merge?: boolean;
  delete_branch_on_merge?: boolean;
  allow_update_branch?: boolean;
  squash_merge_commit_title?: string;
  squash_merge_commit_message?: string;
  merge_commit_title?: string;
  merge_commit_message?: string;
  web_commit_signoff_required?: boolean;
  default_branch?: string;
  security_and_analysis?: {
    secret_scanning?: { status: string };
    secret_scanning_push_protection?: { status: string };
    secret_scanning_validity_checks?: { status: string };
  };
  // Security settings (fetched from separate endpoints)
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
    options?: RepoSettingsStrategyOptions
  ): Promise<CurrentRepoSettings>;

  /**
   * Updates repository settings.
   */
  updateSettings(
    repoInfo: RepoInfo,
    settings: GitHubRepoSettings,
    options?: RepoSettingsStrategyOptions
  ): Promise<void>;

  /**
   * Enables or disables vulnerability alerts.
   */
  setVulnerabilityAlerts(
    repoInfo: RepoInfo,
    enable: boolean,
    options?: RepoSettingsStrategyOptions
  ): Promise<void>;

  /**
   * Enables or disables automated security fixes.
   */
  setAutomatedSecurityFixes(
    repoInfo: RepoInfo,
    enable: boolean,
    options?: RepoSettingsStrategyOptions
  ): Promise<void>;
}

/**
 * Type guard to check if an object implements IRepoSettingsStrategy.
 */
export function isRepoSettingsStrategy(
  obj: unknown
): obj is IRepoSettingsStrategy {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }
  const strategy = obj as Record<string, unknown>;
  return (
    typeof strategy.getSettings === "function" &&
    typeof strategy.updateSettings === "function" &&
    typeof strategy.setVulnerabilityAlerts === "function" &&
    typeof strategy.setAutomatedSecurityFixes === "function"
  );
}
