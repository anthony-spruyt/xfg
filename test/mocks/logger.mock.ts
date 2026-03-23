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
  warnings: string[];
  diffStatuses: DiffStatusEntry[];
  diffSummaries: DiffSummaryEntry[];
  reset: () => void;
}

export function createMockLogger(): LoggerMockResult {
  const messages: string[] = [];
  const warnings: string[] = [];
  const diffStatuses: DiffStatusEntry[] = [];
  const diffSummaries: DiffSummaryEntry[] = [];

  const mock: ILogger = {
    log(message: string): void {
      messages.push(message);
    },
    info(message: string): void {
      messages.push(message);
    },
    debug(message: string): void {
      messages.push(message);
    },
    warn(message: string): void {
      warnings.push(message);
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
    progress(_repoNumber: number, _repoName: string, _message: string): void {
      // No-op
    },
    success(_repoNumber: number, _repoName: string, _message: string): void {
      // No-op
    },
    skip(_repoNumber: number, _repoName: string, _reason: string): void {
      // No-op
    },
    error(_repoNumber: number, _repoName: string, _error: string): void {
      // No-op
    },
  };

  return {
    mock,
    messages,
    warnings,
    diffStatuses,
    diffSummaries,
    reset: () => {
      messages.length = 0;
      warnings.length = 0;
      diffStatuses.length = 0;
      diffSummaries.length = 0;
    },
  };
}
