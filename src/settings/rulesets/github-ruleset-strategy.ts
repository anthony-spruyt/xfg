import type { ICommandExecutor } from "../../shared/command-executor.js";
import { assertGitHubRepo, type RepoInfo } from "../../repo/index.js";
import { camelToSnake } from "../../shared/string-utils.js";
import { GhApiClient, type GhApiOptions } from "../../shared/gh-api-utils.js";
import { parseApiJson } from "../../shared/json-utils.js";
import type { Ruleset, RulesetRule } from "../../config/index.js";
import type {
  IRulesetStrategy,
  GitHubRuleset,
  GitHubBypassActor,
  GitHubRulesetConditions,
  GitHubRule,
  RulesetCreateParams,
  RulesetUpdateParams,
} from "./types.js";

/**
 * Converts camelCase config ruleset to snake_case GitHub API format.
 */
export function configToGitHub(
  name: string,
  ruleset: Ruleset
): GitHubRulesetPayload {
  const payload: GitHubRulesetPayload = {
    name,
    target: ruleset.target ?? "branch",
    enforcement: ruleset.enforcement ?? "active",
  };

  if (ruleset.bypassActors && ruleset.bypassActors.length > 0) {
    payload.bypass_actors = ruleset.bypassActors.map((actor) => ({
      actor_id: actor.actorId,
      actor_type: actor.actorType,
      ...(actor.bypassMode && { bypass_mode: actor.bypassMode }),
    }));
  }

  if (ruleset.conditions) {
    payload.conditions = {};
    if (ruleset.conditions.refName) {
      // GitHub API requires both include and exclude, even if empty
      payload.conditions.ref_name = {
        include: ruleset.conditions.refName.include ?? [],
        exclude: ruleset.conditions.refName.exclude ?? [],
      };
    }
  }

  if (ruleset.rules && ruleset.rules.length > 0) {
    payload.rules = ruleset.rules.map(convertRule);
  }

  return payload;
}

/**
 * Default parameters for pull_request rules.
 * GitHub API requires all parameters to be present.
 */
interface PullRequestRuleDefaults {
  required_approving_review_count: number;
  dismiss_stale_reviews_on_push: boolean;
  require_code_owner_review: boolean;
  require_last_push_approval: boolean;
  required_review_thread_resolution: boolean;
  allowed_merge_methods: string[];
}

const PULL_REQUEST_DEFAULTS: PullRequestRuleDefaults = {
  required_approving_review_count: 0,
  dismiss_stale_reviews_on_push: false,
  require_code_owner_review: false,
  require_last_push_approval: false,
  required_review_thread_resolution: false,
  allowed_merge_methods: ["merge", "squash", "rebase"],
};

/**
 * Converts a single rule from config format to GitHub API format.
 * Handles parameter name conversions (camelCase → snake_case).
 * Fills in required defaults for rule types that need them.
 */
function convertRule(rule: RulesetRule): GitHubRule {
  const result: GitHubRule = { type: rule.type };

  if ("parameters" in rule && rule.parameters) {
    const converted = convertParameters(
      rule.parameters as Record<string, unknown>
    );

    // Fill in defaults for pull_request rules (API requires all params)
    if (rule.type === "pull_request") {
      result.parameters = { ...PULL_REQUEST_DEFAULTS, ...converted };
    } else {
      result.parameters = converted;
    }
  } else if (rule.type === "pull_request") {
    // If no parameters provided, use defaults
    result.parameters = { ...PULL_REQUEST_DEFAULTS };
  }

  return result;
}

/**
 * Converts rule parameters from camelCase to snake_case.
 */
function convertParameters(
  params: Record<string, unknown>
): Record<string, unknown> {
  const converted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(params)) {
    const snakeKey = camelToSnake(key);
    converted[snakeKey] = convertValue(value);
  }

  return converted;
}

/**
 * Converts nested values within parameters.
 */
function convertValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    // Handle arrays of objects (e.g., requiredStatusChecks, codeScanningTools)
    return value.map((item) => {
      if (typeof item === "object" && item !== null) {
        const converted: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
          converted[camelToSnake(k)] = v;
        }
        return converted;
      }
      return item;
    });
  }
  return value;
}

interface GitHubRulesetPayload {
  name: string;
  target: "branch" | "tag";
  enforcement: "active" | "disabled" | "evaluate";
  bypass_actors?: GitHubBypassActor[];
  conditions?: GitHubRulesetConditions;
  rules?: GitHubRule[];
}

interface GitHubRulesetStrategyOptions {
  retries?: number;
  cwd: string;
}

export class GitHubRulesetStrategy implements IRulesetStrategy {
  private api: GhApiClient;

  constructor(
    executor: ICommandExecutor,
    options: GitHubRulesetStrategyOptions
  ) {
    this.api = new GhApiClient(executor, options.retries ?? 3, options.cwd);
  }

  async list(
    repoInfo: RepoInfo,
    options?: GhApiOptions
  ): Promise<GitHubRuleset[]> {
    assertGitHubRepo(repoInfo, "GitHub Ruleset strategy");

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/rulesets`;
    const result = await this.api.call("GET", endpoint, { options });

    return parseApiJson<GitHubRuleset[]>(result, "rulesets response");
  }

  async get(
    repoInfo: RepoInfo,
    rulesetId: number,
    options?: GhApiOptions
  ): Promise<GitHubRuleset> {
    assertGitHubRepo(repoInfo, "GitHub Ruleset strategy");

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/rulesets/${rulesetId}`;
    const result = await this.api.call("GET", endpoint, { options });

    return parseApiJson<GitHubRuleset>(result, "ruleset response");
  }

  async create(
    repoInfo: RepoInfo,
    params: RulesetCreateParams,
    options?: GhApiOptions
  ): Promise<GitHubRuleset> {
    assertGitHubRepo(repoInfo, "GitHub Ruleset strategy");

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/rulesets`;
    const payload = configToGitHub(params.name, params.ruleset);
    const result = await this.api.call("POST", endpoint, { payload, options });

    return parseApiJson<GitHubRuleset>(result, "ruleset response");
  }

  async update(
    repoInfo: RepoInfo,
    params: RulesetUpdateParams,
    options?: GhApiOptions
  ): Promise<GitHubRuleset> {
    assertGitHubRepo(repoInfo, "GitHub Ruleset strategy");

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/rulesets/${params.rulesetId}`;
    const payload = configToGitHub(params.name, params.ruleset);
    const result = await this.api.call("PUT", endpoint, {
      payload,
      options,
    });

    return parseApiJson<GitHubRuleset>(result, "ruleset response");
  }

  async delete(
    repoInfo: RepoInfo,
    rulesetId: number,
    options?: GhApiOptions
  ): Promise<void> {
    assertGitHubRepo(repoInfo, "GitHub Ruleset strategy");

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/rulesets/${rulesetId}`;
    await this.api.call("DELETE", endpoint, { options });
  }
}
