import type { ILogger } from "../../src/shared/logger.js";
import type { FileStatus } from "../../src/sync/diff-utils.js";

export interface DiffStatusEntry {
  fileName: string;
  status: FileStatus;
}

export interface DiffSummaryEntry {
  newCount: number;
  modifiedCount: number;
  unchangedCount: number;
  deletedCount?: number;
}

export interface LoggerMockResult {
  mock: ILogger;
  messages: string[];
  diffStatuses: DiffStatusEntry[];
  diffSummaries: DiffSummaryEntry[];
  reset: () => void;
}

export function createMockLogger(): LoggerMockResult {
  const messages: string[] = [];
  const diffStatuses: DiffStatusEntry[] = [];
  const diffSummaries: DiffSummaryEntry[] = [];

  const mock: ILogger = {
    info(message: string): void {
      messages.push(message);
    },
    fileDiff(fileName: string, status: FileStatus, _diffLines: string[]): void {
      diffStatuses.push({ fileName, status });
    },
    diffSummary(
      newCount: number,
      modifiedCount: number,
      unchangedCount: number,
      deletedCount?: number
    ): void {
      diffSummaries.push({
        newCount,
        modifiedCount,
        unchangedCount,
        deletedCount,
      });
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
    diffSummaries,
    reset: () => {
      messages.length = 0;
      diffStatuses.length = 0;
      diffSummaries.length = 0;
    },
  };
}
