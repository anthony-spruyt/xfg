import type { RepoInfo } from "../../repo/index.js";
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

export interface RulesetCreateParams {
  name: string;
  ruleset: Ruleset;
}

export interface RulesetUpdateParams {
  rulesetId: number;
  name: string;
  ruleset: Ruleset;
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
    params: RulesetCreateParams,
    options?: GhApiOptions
  ): Promise<void>;
  update(
    repoInfo: RepoInfo,
    params: RulesetUpdateParams,
    options?: GhApiOptions
  ): Promise<void>;
  delete(
    repoInfo: RepoInfo,
    rulesetId: number,
    options?: GhApiOptions
  ): Promise<void>;
}
