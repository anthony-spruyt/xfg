import type { ProcessorResults } from "./settings-report-builder.js";

/**
 * Collects processing results for the SettingsReport.
 * Provides a centralized way to track results across rulesets, repo settings, and labels.
 */
export class ResultsCollector {
  private readonly results: ProcessorResults[] = [];

  getOrCreate(repoName: string): ProcessorResults {
    let result = this.results.find((r) => r.repoName === repoName);
    if (!result) {
      result = { repoName };
      this.results.push(result);
    }
    return result;
  }

  appendError(repoName: string, error: unknown): void {
    const existing = this.getOrCreate(repoName);
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (existing.error) {
      existing.error += `; ${errorMsg}`;
    } else {
      existing.error = errorMsg;
    }
  }

  getAll(): ProcessorResults[] {
    return this.results;
  }
}
