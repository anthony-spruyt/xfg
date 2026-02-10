import {
  ICommandExecutor,
  defaultExecutor,
} from "../shared/command-executor.js";
import {
  isGitHubRepo,
  GitHubRepoInfo,
  RepoInfo,
} from "../shared/repo-detector.js";
import { escapeShellArg } from "../shared/shell-utils.js";
import type { Ruleset, RulesetRule } from "../config/index.js";
import type { IRulesetStrategy } from "./ruleset-strategy.js";

// =============================================================================
// GitHub API Types
// =============================================================================

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

// =============================================================================
// Conversion Functions
// =============================================================================

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
const PULL_REQUEST_DEFAULTS: Record<string, unknown> = {
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

/**
 * Converts camelCase to snake_case.
 */
function camelToSnake(str: string): string {
  return str.replace(/([A-Z])/g, "_$1").toLowerCase();
}

// =============================================================================
// Payload Types
// =============================================================================

export interface GitHubRulesetPayload {
  name: string;
  target: "branch" | "tag";
  enforcement: "active" | "disabled" | "evaluate";
  bypass_actors?: GitHubBypassActor[];
  conditions?: GitHubRulesetConditions;
  rules?: GitHubRule[];
}

// =============================================================================
// Strategy Implementation
// =============================================================================

export interface RulesetStrategyOptions {
  token?: string;
  host?: string;
}

/**
 * GitHub Ruleset Strategy for managing repository rulesets via GitHub REST API.
 * Uses `gh api` CLI for authentication and API calls.
 */
export class GitHubRulesetStrategy implements IRulesetStrategy {
  private executor: ICommandExecutor;

  constructor(executor?: ICommandExecutor) {
    this.executor = executor ?? defaultExecutor;
  }

  /**
   * Lists all rulesets for a repository.
   */
  async list(
    repoInfo: RepoInfo,
    options?: RulesetStrategyOptions
  ): Promise<GitHubRuleset[]> {
    this.validateGitHub(repoInfo);
    const github = repoInfo as GitHubRepoInfo;

    const endpoint = `/repos/${github.owner}/${github.repo}/rulesets`;
    const result = await this.ghApi("GET", endpoint, undefined, options);

    return JSON.parse(result) as GitHubRuleset[];
  }

  /**
   * Gets a single ruleset by ID.
   */
  async get(
    repoInfo: RepoInfo,
    rulesetId: number,
    options?: RulesetStrategyOptions
  ): Promise<GitHubRuleset> {
    this.validateGitHub(repoInfo);
    const github = repoInfo as GitHubRepoInfo;

    const endpoint = `/repos/${github.owner}/${github.repo}/rulesets/${rulesetId}`;
    const result = await this.ghApi("GET", endpoint, undefined, options);

    return JSON.parse(result) as GitHubRuleset;
  }

  /**
   * Creates a new ruleset.
   */
  async create(
    repoInfo: RepoInfo,
    name: string,
    ruleset: Ruleset,
    options?: RulesetStrategyOptions
  ): Promise<GitHubRuleset> {
    this.validateGitHub(repoInfo);
    const github = repoInfo as GitHubRepoInfo;

    const endpoint = `/repos/${github.owner}/${github.repo}/rulesets`;
    const payload = configToGitHub(name, ruleset);
    const result = await this.ghApi("POST", endpoint, payload, options);

    return JSON.parse(result) as GitHubRuleset;
  }

  /**
   * Updates an existing ruleset.
   */
  async update(
    repoInfo: RepoInfo,
    rulesetId: number,
    name: string,
    ruleset: Ruleset,
    options?: RulesetStrategyOptions
  ): Promise<GitHubRuleset> {
    this.validateGitHub(repoInfo);
    const github = repoInfo as GitHubRepoInfo;

    const endpoint = `/repos/${github.owner}/${github.repo}/rulesets/${rulesetId}`;
    const payload = configToGitHub(name, ruleset);
    const result = await this.ghApi("PUT", endpoint, payload, options);

    return JSON.parse(result) as GitHubRuleset;
  }

  /**
   * Deletes a ruleset.
   */
  async delete(
    repoInfo: RepoInfo,
    rulesetId: number,
    options?: RulesetStrategyOptions
  ): Promise<void> {
    this.validateGitHub(repoInfo);
    const github = repoInfo as GitHubRepoInfo;

    const endpoint = `/repos/${github.owner}/${github.repo}/rulesets/${rulesetId}`;
    await this.ghApi("DELETE", endpoint, undefined, options);
  }

  /**
   * Validates that the repo is a GitHub repository.
   */
  private validateGitHub(repoInfo: RepoInfo): void {
    if (!isGitHubRepo(repoInfo)) {
      throw new Error(
        `GitHub Ruleset strategy requires GitHub repositories. Got: ${repoInfo.type}`
      );
    }
  }

  /**
   * Executes a GitHub API call using the gh CLI.
   */
  private async ghApi(
    method: "GET" | "POST" | "PUT" | "DELETE",
    endpoint: string,
    payload?: unknown,
    options?: RulesetStrategyOptions
  ): Promise<string> {
    const args: string[] = ["gh", "api"];

    // Add method flag
    if (method !== "GET") {
      args.push("-X", method);
    }

    // Add host flag for GitHub Enterprise
    if (options?.host && options.host !== "github.com") {
      args.push("--hostname", escapeShellArg(options.host));
    }

    // Add endpoint
    args.push(escapeShellArg(endpoint));

    // Build base command
    const baseCommand = args.join(" ");

    // Add GH_TOKEN environment variable prefix if token provided
    // Token is escaped to prevent command injection
    const tokenPrefix = options?.token
      ? `GH_TOKEN=${escapeShellArg(options.token)} `
      : "";

    // For POST/PUT with payload, use echo pipe pattern (same as graphql-commit-strategy)
    // This is safer than heredoc as escapeShellArg properly escapes the content
    if (payload && (method === "POST" || method === "PUT")) {
      const payloadJson = JSON.stringify(payload);
      const command = `echo ${escapeShellArg(payloadJson)} | ${tokenPrefix}${baseCommand} --input -`;
      return await this.executor.exec(command, process.cwd());
    }

    // For GET/DELETE, run command directly
    const command = `${tokenPrefix}${baseCommand}`;
    return await this.executor.exec(command, process.cwd());
  }
}
