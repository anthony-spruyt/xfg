import { toErrorMessage } from "../shared/type-guards.js";
import { withRetry } from "../shared/retry-utils.js";
import type { PRResult } from "./types.js";
import { ICommandExecutor } from "../shared/command-executor.js";
import type {
  MergeResult,
  PRStrategyOptions,
  MergeOptions,
  CloseExistingPROptions,
  IPRStrategy,
} from "./types.js";

export interface IPRStrategyLogger {
  debug(msg: string): void;
  warn(msg: string): void;
  info(msg: string): void;
}

export abstract class BasePRStrategy implements IPRStrategy {
  protected bodyFilePath: string = ".pr-body.md";
  protected executor: ICommandExecutor;
  protected log?: IPRStrategyLogger;

  constructor(executor: ICommandExecutor, log?: IPRStrategyLogger) {
    this.executor = executor;
    this.log = log;
  }

  abstract checkExistingPR(
    options: CloseExistingPROptions
  ): Promise<string | null>;
  abstract closeExistingPR(options: CloseExistingPROptions): Promise<boolean>;
  abstract create(options: PRStrategyOptions): Promise<PRResult>;
  abstract merge(options: MergeOptions): Promise<MergeResult>;

  /**
   * Execute a merge command with retries, returning a standardized MergeResult.
   * Shared by all platform strategies to eliminate duplicated try/catch patterns.
   */
  protected async executeMergeCommand(
    execFn: () => Promise<unknown>,
    retries: number,
    successResult: MergeResult,
    errorPrefix: string
  ): Promise<MergeResult> {
    try {
      await withRetry(execFn, { retries, log: this.log });
      return successResult;
    } catch (error) {
      return {
        success: false,
        message: `${errorPrefix}: ${toErrorMessage(error)}`,
        merged: false,
      };
    }
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
      const message = toErrorMessage(error);
      return {
        success: false,
        message: `Failed to create PR: ${message}`,
      };
    }
  }
}
