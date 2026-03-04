import { PRResult } from "./pr-creator.js";
import {
  ICommandExecutor,
  defaultExecutor,
} from "../shared/command-executor.js";
import type {
  MergeResult,
  PRStrategyOptions,
  MergeOptions,
  CloseExistingPROptions,
  IPRStrategy,
} from "./types.js";

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

export class PRWorkflowExecutor {
  constructor(private readonly strategy: IPRStrategy) {}

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
