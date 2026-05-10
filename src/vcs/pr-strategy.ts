import { toErrorMessage } from "../shared/type-guards.js";
import { withRetry, isPermanentError } from "../shared/retry-utils.js";
import type { DebugWarnLog } from "../shared/logger.js";
import type { PRResult } from "./types.js";
import type { ICommandExecutor } from "../shared/command-executor.js";
import type {
  MergeResult,
  PRStrategyOptions,
  MergeOptions,
  CloseExistingPROptions,
  ClosePRResult,
  IPRStrategy,
} from "./types.js";

export interface IPRStrategyLogger {
  debug(msg: string): void;
  warn(msg: string): void;
  info(msg: string): void;
}

export abstract class BasePRStrategy implements IPRStrategy {
  protected executor: ICommandExecutor;
  protected log?: IPRStrategyLogger;

  constructor(executor: ICommandExecutor, log?: IPRStrategyLogger) {
    this.executor = executor;
    this.log = log;
  }

  abstract findExistingPRUrl(
    options: CloseExistingPROptions
  ): Promise<string | null>;
  abstract closeExistingPR(
    options: CloseExistingPROptions
  ): Promise<ClosePRResult>;
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
    const result = await withRetry(execFn, { retries, log: this.log }).then(
      () => successResult,
      (error: unknown) => {
        const message = `${errorPrefix}: ${toErrorMessage(error)}`;
        this.log?.warn(message);
        return { success: false, message, merged: false } as MergeResult;
      }
    );
    return result;
  }
}

export class PRWorkflowExecutor {
  constructor(
    private readonly strategy: IPRStrategy,
    private readonly log?: DebugWarnLog
  ) {}

  async execute(options: PRStrategyOptions): Promise<PRResult> {
    try {
      const existingUrl = await this.strategy.findExistingPRUrl(options);
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
      if (isPermanentError(error)) {
        this.log?.warn(`PR creation failed (permanent): ${message}`);
      }
      return {
        success: false,
        message: `Failed to create PR: ${message}`,
      };
    }
  }
}
