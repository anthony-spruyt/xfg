import { PRResult } from "../pr-creator.js";
import { RepoInfo } from "../repo-detector.js";

export interface PRStrategyOptions {
  repoInfo: RepoInfo;
  title: string;
  body: string;
  branchName: string;
  baseBranch: string;
  workDir: string;
}

export interface PRStrategy {
  /**
   * Check if a PR already exists for the given branch
   * @returns PR URL if exists, null otherwise
   */
  checkExistingPR(options: PRStrategyOptions): Promise<string | null>;

  /**
   * Create a new PR
   * @returns Result with URL and status
   */
  create(options: PRStrategyOptions): Promise<PRResult>;

  /**
   * Execute the full PR creation workflow
   */
  execute(options: PRStrategyOptions): Promise<PRResult>;
}

export abstract class BasePRStrategy implements PRStrategy {
  protected bodyFilePath: string = ".pr-body.md";

  abstract checkExistingPR(options: PRStrategyOptions): Promise<string | null>;
  abstract create(options: PRStrategyOptions): Promise<PRResult>;

  /**
   * Execute the full PR creation workflow:
   * 1. Check for existing PR
   * 2. If exists, return it
   * 3. Otherwise, create new PR
   */
  async execute(options: PRStrategyOptions): Promise<PRResult> {
    try {
      const existingUrl = await this.checkExistingPR(options);
      if (existingUrl) {
        return {
          url: existingUrl,
          success: true,
          message: `PR already exists: ${existingUrl}`,
        };
      }
      return await this.create(options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to create PR: ${message}`,
      };
    }
  }
}
