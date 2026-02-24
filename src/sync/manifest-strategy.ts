import type { RepoConfig } from "../config/types.js";
import type { RepoInfo } from "../shared/repo-detector.js";
import type { ILogger } from "../shared/logger.js";
import {
  loadManifest,
  saveManifest,
  updateManifestRulesets,
  updateManifestLabels,
  MANIFEST_FILENAME,
} from "./manifest.js";
import type {
  IWorkStrategy,
  WorkResult,
  SessionContext,
  ProcessorOptions,
  FileWriteResult,
} from "./types.js";

/**
 * Parameters for manifest-only updates
 */
export interface ManifestUpdateParams {
  rulesets?: string[];
  labels?: string[];
}

/**
 * Strategy that only updates the manifest with ruleset tracking.
 * Used by updateManifestOnly() for settings command ruleset sync.
 */
export class ManifestStrategy implements IWorkStrategy {
  constructor(
    private readonly params: ManifestUpdateParams,
    private readonly log: ILogger
  ) {}

  async execute(
    _repoConfig: RepoConfig,
    _repoInfo: RepoInfo,
    _session: SessionContext,
    options: ProcessorOptions
  ): Promise<WorkResult | null> {
    const { workDir, dryRun, configId } = options;

    // Load and update manifest
    const existingManifest = loadManifest(workDir);
    let newManifest = existingManifest;

    // Apply rulesets update if present
    if (this.params.rulesets) {
      const rulesetsWithDeleteOrphaned = new Map<string, boolean | undefined>(
        this.params.rulesets.map((name) => [name, true])
      );
      const result = updateManifestRulesets(
        newManifest,
        configId,
        rulesetsWithDeleteOrphaned
      );
      newManifest = result.manifest;
    }

    // Apply labels update if present
    if (this.params.labels) {
      const labelsWithDeleteOrphaned = new Map<string, boolean | undefined>(
        this.params.labels.map((name) => [name, true])
      );
      const result = updateManifestLabels(
        newManifest,
        configId,
        labelsWithDeleteOrphaned
      );
      newManifest = result.manifest;
    }

    // Check if changed
    const existingConfigs = existingManifest?.configs ?? {};
    if (
      JSON.stringify(existingConfigs) === JSON.stringify(newManifest!.configs)
    ) {
      return null;
    }

    // Build dynamic commit message
    const parts: string[] = [];
    if (this.params.rulesets) parts.push("ruleset");
    if (this.params.labels) parts.push("labels");
    const trackingType = parts.join("/");

    if (dryRun) {
      this.log.info(
        `Would update ${MANIFEST_FILENAME} with ${trackingType} tracking`
      );
    } else {
      saveManifest(workDir, newManifest!);
    }

    const fileChanges = new Map<string, FileWriteResult>([
      [
        MANIFEST_FILENAME,
        {
          fileName: MANIFEST_FILENAME,
          content: JSON.stringify(newManifest, null, 2) + "\n",
          action: "update",
        },
      ],
    ]);

    return {
      fileChanges,
      changedFiles: [
        { fileName: MANIFEST_FILENAME, action: "update" as const },
      ],
      commitMessage: `chore: update manifest with ${trackingType} tracking`,
      fileChangeDetails: [{ path: MANIFEST_FILENAME, action: "update" }],
    };
  }
}
