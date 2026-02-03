import type { ILogger } from "../../src/logger.js";
import type { FileStatus } from "../../src/diff-utils.js";

export interface LoggerMockResult {
  mock: ILogger;
  messages: string[];
  reset: () => void;
}

export function createMockLogger(): LoggerMockResult {
  const messages: string[] = [];

  const mock: ILogger = {
    info(message: string): void {
      messages.push(message);
    },
    fileDiff(
      _fileName: string,
      _status: FileStatus,
      _diffLines: string[]
    ): void {
      // No-op
    },
    diffSummary(
      _newCount: number,
      _modifiedCount: number,
      _unchangedCount: number,
      _deletedCount?: number
    ): void {
      // No-op
    },
    setTotal(_total: number): void {
      // No-op
    },
    progress(_current: number, _repoName: string, _message: string): void {
      // No-op
    },
    success(_current: number, _repoName: string, _message: string): void {
      // No-op
    },
    skip(_current: number, _repoName: string, _reason: string): void {
      // No-op
    },
    error(_current: number, _repoName: string, _error: string): void {
      // No-op
    },
    summary(): void {
      // No-op
    },
    hasFailures(): boolean {
      return false;
    },
  };

  return {
    mock,
    messages,
    reset: () => {
      messages.length = 0;
    },
  };
}
