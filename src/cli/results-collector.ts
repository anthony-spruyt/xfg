import type { ProcessorResults } from "./settings-report-builder.js";
import { toErrorMessage } from "../shared/type-guards.js";

/**
 * Collects processing results for the SettingsReport.
 * Provides a centralized way to track results across rulesets, repo settings, and labels.
 */
export class ResultsCollector {
  private readonly results: ProcessorResults[] = [];

  findOrCreate(repoName: string): ProcessorResults {
    let result = this.results.find((r) => r.repoName === repoName);
    if (!result) {
      result = { repoName };
      this.results.push(result);
    }
    return result;
  }

  appendError(repoName: string, error: unknown): void {
    const existing = this.findOrCreate(repoName);
    const errorMsg = toErrorMessage(error);
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
