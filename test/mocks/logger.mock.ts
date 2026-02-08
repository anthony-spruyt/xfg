import type { ILogger } from "../../src/logger.js";
import type { FileStatus } from "../../src/diff-utils.js";

export interface DiffStatusEntry {
  fileName: string;
  status: FileStatus;
}

export interface LoggerMockResult {
  mock: ILogger;
  messages: string[];
  diffStatuses: DiffStatusEntry[];
  reset: () => void;
}

export function createMockLogger(): LoggerMockResult {
  const messages: string[] = [];
  const diffStatuses: DiffStatusEntry[] = [];

  const mock: ILogger = {
    info(message: string): void {
      messages.push(message);
    },
    fileDiff(fileName: string, status: FileStatus, _diffLines: string[]): void {
      diffStatuses.push({ fileName, status });
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
  };

  return {
    mock,
    messages,
    diffStatuses,
    reset: () => {
      messages.length = 0;
      diffStatuses.length = 0;
    },
  };
}
