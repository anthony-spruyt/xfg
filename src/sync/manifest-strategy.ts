import type { RepoConfig } from "../config/types.js";
import type { RepoInfo } from "../shared/repo-detector.js";
import type { ILogger } from "../shared/logger.js";
import {
  loadManifest,
  saveManifest,
  updateManifestRulesets,
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
  rulesets: string[];
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
    const rulesetsWithDeleteOrphaned = new Map<string, boolean | undefined>(
      this.params.rulesets.map((name) => [name, true])
    );
    const { manifest: newManifest } = updateManifestRulesets(
      existingManifest,
      configId,
      rulesetsWithDeleteOrphaned
    );

    // Check if changed
    const existingConfigs = existingManifest?.configs ?? {};
    if (
      JSON.stringify(existingConfigs) === JSON.stringify(newManifest.configs)
    ) {
      return null;
    }

    if (dryRun) {
      this.log.info(`Would update ${MANIFEST_FILENAME} with rulesets`);
    }

    saveManifest(workDir, newManifest);

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
      commitMessage: "chore: update manifest with ruleset tracking",
      fileChangeDetails: [{ path: MANIFEST_FILENAME, action: "update" }],
    };
  }
}
