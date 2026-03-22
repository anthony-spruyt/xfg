import type { RepoInfo } from "../../shared/repo-detector.js";
import type { Ruleset } from "../../config/index.js";
import type { GhApiOptions } from "../../shared/gh-api-utils.js";

/**
 * GitHub Ruleset response from API (snake_case).
 */
export interface GitHubRuleset {
  id: number;
  name: string;
  target: "branch" | "tag";
  enforcement: "active" | "disabled" | "evaluate";
  bypass_actors?: GitHubBypassActor[];
  conditions?: GitHubRulesetConditions;
  rules?: GitHubRule[];
  source_type?: string;
  source?: string;
}

export interface GitHubBypassActor {
  actor_id: number;
  actor_type: "Team" | "User" | "Integration";
  bypass_mode?: "always" | "pull_request";
}

export interface GitHubRulesetConditions {
  ref_name?: {
    include?: string[];
    exclude?: string[];
  };
}

export interface GitHubRule {
  type: string;
  parameters?: Record<string, unknown>;
}

export interface RulesetUpdateParams {
  rulesetId: number;
  name: string;
  ruleset: Ruleset;
  options?: GhApiOptions;
}

export interface IRulesetStrategy {
  list(repoInfo: RepoInfo, options?: GhApiOptions): Promise<GitHubRuleset[]>;
  get(
    repoInfo: RepoInfo,
    rulesetId: number,
    options?: GhApiOptions
  ): Promise<GitHubRuleset>;
  create(
    repoInfo: RepoInfo,
    name: string,
    ruleset: Ruleset,
    options?: GhApiOptions
  ): Promise<GitHubRuleset>;
  update(
    repoInfo: RepoInfo,
    params: RulesetUpdateParams
  ): Promise<GitHubRuleset>;
  delete(
    repoInfo: RepoInfo,
    rulesetId: number,
    options?: GhApiOptions
  ): Promise<void>;
}
