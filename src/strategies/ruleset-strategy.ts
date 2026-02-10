import type { RepoInfo } from "../shared/repo-detector.js";
import type { Ruleset } from "../config/index.js";
import type {
  GitHubRuleset,
  RulesetStrategyOptions,
} from "./github-ruleset-strategy.js";

export interface IRulesetStrategy {
  list(
    repoInfo: RepoInfo,
    options?: RulesetStrategyOptions
  ): Promise<GitHubRuleset[]>;
  get(
    repoInfo: RepoInfo,
    rulesetId: number,
    options?: RulesetStrategyOptions
  ): Promise<GitHubRuleset>;
  create(
    repoInfo: RepoInfo,
    name: string,
    ruleset: Ruleset,
    options?: RulesetStrategyOptions
  ): Promise<GitHubRuleset>;
  update(
    repoInfo: RepoInfo,
    rulesetId: number,
    name: string,
    ruleset: Ruleset,
    options?: RulesetStrategyOptions
  ): Promise<GitHubRuleset>;
  delete(
    repoInfo: RepoInfo,
    rulesetId: number,
    options?: RulesetStrategyOptions
  ): Promise<void>;
}
