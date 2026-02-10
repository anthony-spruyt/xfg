import { PRResult } from "../git/pr-creator.js";
import { RepoInfo } from "../shared/repo-detector.js";
import {
  ICommandExecutor,
  defaultExecutor,
} from "../shared/command-executor.js";
import type { MergeMode, MergeStrategy } from "../config/index.js";

export interface PRMergeConfig {
  mode: MergeMode;
  strategy?: MergeStrategy;
  deleteBranch?: boolean;
  bypassReason?: string;
}

export interface MergeResult {
  success: boolean;
  message: string;
  merged?: boolean;
  autoMergeEnabled?: boolean;
}

export interface PRStrategyOptions {
  repoInfo: RepoInfo;
  title: string;
  body: string;
  branchName: string;
  baseBranch: string;
  workDir: string;
  /** Number of retries for API operations (default: 3) */
  retries?: number;
  /** GitHub App installation token for authentication */
  token?: string;
}

export interface MergeOptions {
  prUrl: string;
  config: PRMergeConfig;
  workDir: string;
  retries?: number;
  /** GitHub App installation token for authentication */
  token?: string;
}

/**
 * Options for closing an existing PR.
 */
export interface CloseExistingPROptions {
  repoInfo: RepoInfo;
  branchName: string;
  baseBranch: string;
  workDir: string;
  retries?: number;
  /** GitHub App installation token for authentication */
  token?: string;
}

/**
 * Interface for PR creation strategies (platform-specific implementations).
 * Strategies focus on platform-specific logic (checkExistingPR, create, merge).
 * Use PRWorkflowExecutor for full workflow orchestration with error handling.
 */
export interface IPRStrategy {
  /**
   * Check if a PR already exists for the given branch
   * @returns PR URL if exists, null otherwise
   */
  checkExistingPR(options: PRStrategyOptions): Promise<string | null>;

  /**
   * Close an existing PR and delete its branch.
   * Used for fresh start approach - always create new PR from clean state.
   * @returns true if PR was closed, false if no PR existed
   */
  closeExistingPR(options: CloseExistingPROptions): Promise<boolean>;

  /**
   * Create a new PR
   * @returns Result with URL and status
   */
  create(options: PRStrategyOptions): Promise<PRResult>;

  /**
   * Merge or enable auto-merge for a PR
   * @returns Result with merge status
   */
  merge(options: MergeOptions): Promise<MergeResult>;

  /**
   * Execute the full PR creation workflow
   * @deprecated Use PRWorkflowExecutor.execute() for better SRP
   */
  execute(options: PRStrategyOptions): Promise<PRResult>;
}

export abstract class BasePRStrategy implements IPRStrategy {
  protected bodyFilePath: string = ".pr-body.md";
  protected executor: ICommandExecutor;

  constructor(executor?: ICommandExecutor) {
    this.executor = executor ?? defaultExecutor;
  }

  abstract checkExistingPR(options: PRStrategyOptions): Promise<string | null>;
  abstract closeExistingPR(options: CloseExistingPROptions): Promise<boolean>;
  abstract create(options: PRStrategyOptions): Promise<PRResult>;
  abstract merge(options: MergeOptions): Promise<MergeResult>;

  /**
   * Execute the full PR creation workflow:
   * 1. Check for existing PR
   * 2. If exists, return it
   * 3. Otherwise, create new PR
   *
   * @deprecated Use PRWorkflowExecutor.execute() for better SRP
   */
  async execute(options: PRStrategyOptions): Promise<PRResult> {
    const executor = new PRWorkflowExecutor(this);
    return executor.execute(options);
  }
}

/**
 * Orchestrates the PR creation workflow with error handling.
 * Follows Single Responsibility Principle by separating workflow orchestration
 * from platform-specific PR creation logic.
 *
 * Workflow:
 * 1. Check for existing PR on the branch
 * 2. If exists, return existing PR URL
 * 3. Otherwise, create new PR
 * 4. Handle errors and return failure result
 */
export class PRWorkflowExecutor {
  constructor(private readonly strategy: IPRStrategy) {}

  /**
   * Execute the full PR creation workflow with error handling.
   */
  async execute(options: PRStrategyOptions): Promise<PRResult> {
    try {
      const existingUrl = await this.strategy.checkExistingPR(options);
      if (existingUrl) {
        return {
          url: existingUrl,
          success: true,
          message: `PR already exists: ${existingUrl}`,
        };
      }
      return await this.strategy.create(options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to create PR: ${message}`,
      };
    }
  }
}
