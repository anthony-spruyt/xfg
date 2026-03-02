import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const MANIFEST_FILENAME = ".xfg.json";

// V1 manifest structure (legacy - for migration detection only)
interface XfgManifestV1 {
  version: 1;
  managedFiles: string[];
}

// V2 manifest structure (legacy - for migration detection only)
interface XfgManifestV2 {
  version: 2;
  configs: Record<string, string[]>; // configId -> managedFiles
}

// V3 manifest structure (legacy - for migration detection only)
interface XfgManifestV3 {
  version: 3;
  configs: Record<
    string,
    {
      files?: string[];
      rulesets?: string[];
      labels?: string[];
    }
  >;
}

// V4 config entry — files only (rulesets and labels removed in V4)
export interface XfgManifestConfigEntry {
  files?: string[];
}

// V4 manifest structure (current)
export interface XfgManifest {
  version: 4;
  configs: Record<string, XfgManifestConfigEntry>;
}

/**
 * Type guard to check if a manifest is v1 format.
 */
function isV1Manifest(manifest: unknown): manifest is XfgManifestV1 {
  return (
    typeof manifest === "object" &&
    manifest !== null &&
    (manifest as XfgManifestV1).version === 1 &&
    Array.isArray((manifest as XfgManifestV1).managedFiles)
  );
}

/**
 * Type guard to check if a manifest is v2 format.
 */
function isV2Manifest(manifest: unknown): manifest is XfgManifestV2 {
  return (
    typeof manifest === "object" &&
    manifest !== null &&
    (manifest as XfgManifestV2).version === 2 &&
    typeof (manifest as XfgManifestV2).configs === "object" &&
    (manifest as XfgManifestV2).configs !== null
  );
}

/**
 * Type guard to check if a manifest is v3 format.
 */
function isV3Manifest(manifest: unknown): manifest is XfgManifestV3 {
  return (
    typeof manifest === "object" &&
    manifest !== null &&
    (manifest as XfgManifestV3).version === 3 &&
    typeof (manifest as XfgManifestV3).configs === "object" &&
    (manifest as XfgManifestV3).configs !== null
  );
}

/**
 * Type guard to check if a manifest is v4 format.
 */
function isV4Manifest(manifest: unknown): manifest is XfgManifest {
  return (
    typeof manifest === "object" &&
    manifest !== null &&
    (manifest as XfgManifest).version === 4 &&
    typeof (manifest as XfgManifest).configs === "object" &&
    (manifest as XfgManifest).configs !== null
  );
}

/**
 * Migrates a V2 manifest to V3 format.
 * V2: configs is Record<string, string[]>
 * V3: configs is Record<string, { files?: string[], rulesets?: string[], labels?: string[] }>
 */
function migrateV2ToV3(v2: XfgManifestV2): XfgManifestV3 {
  const v3Configs: Record<string, { files?: string[] }> = {};

  for (const [configId, files] of Object.entries(v2.configs)) {
    if (files.length > 0) {
      v3Configs[configId] = { files };
    }
  }

  return {
    version: 3,
    configs: v3Configs,
  };
}

/**
 * Migrates a V3 manifest to V4 format.
 * V3: configs have files, rulesets, labels
 * V4: configs have files only — rulesets and labels are dropped
 */
function migrateV3ToV4(v3: XfgManifestV3): XfgManifest {
  const v4Configs: Record<string, XfgManifestConfigEntry> = {};
  for (const [configId, entry] of Object.entries(v3.configs)) {
    // Only preserve files — rulesets and labels are dropped
    if (entry.files && entry.files.length > 0) {
      v4Configs[configId] = { files: entry.files };
    }
  }
  return { version: 4, configs: v4Configs };
}

/**
 * Creates an empty manifest with the current version.
 */
export function createEmptyManifest(): XfgManifest {
  return {
    version: 4,
    configs: {},
  };
}

/**
 * Loads the xfg manifest from a repository's working directory.
 * Returns null if the manifest file doesn't exist or is v1 format.
 *
 * V1 manifests are treated as non-existent because they lack the config ID
 * namespace required for multi-config support. The next run will create
 * a fresh v4 manifest.
 *
 * V2/V3 manifests are automatically migrated to V4 format.
 *
 * @param workDir - The repository working directory
 * @returns The manifest or null if not found or incompatible
 */
export function loadManifest(workDir: string): XfgManifest | null {
  const manifestPath = join(workDir, MANIFEST_FILENAME);

  if (!existsSync(manifestPath)) {
    return null;
  }

  try {
    const content = readFileSync(manifestPath, "utf-8");
    const parsed = JSON.parse(content) as unknown;

    // V4 manifest - return as-is
    if (isV4Manifest(parsed)) {
      return parsed;
    }

    // V3 manifest - migrate to V4
    if (isV3Manifest(parsed)) {
      return migrateV3ToV4(parsed);
    }

    // V2 manifest - migrate to V3, then to V4
    if (isV2Manifest(parsed)) {
      return migrateV3ToV4(migrateV2ToV3(parsed));
    }

    // V1 manifest - treat as no manifest (will be overwritten with v4)
    if (isV1Manifest(parsed)) {
      return null;
    }

    // Unknown format - treat as no manifest
    return null;
  } catch {
    return null;
  }
}

/**
 * Parses manifest content from a string (e.g., fetched from a remote API).
 * Handles V2→V3 migration, returns null for V1/unknown/invalid formats.
 */
export function parseManifestContent(content: string): XfgManifest | null {
  try {
    const parsed = JSON.parse(content) as unknown;

    if (isV4Manifest(parsed)) {
      return parsed;
    }

    if (isV3Manifest(parsed)) {
      return migrateV3ToV4(parsed);
    }

    if (isV2Manifest(parsed)) {
      return migrateV3ToV4(migrateV2ToV3(parsed));
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Saves the xfg manifest to a repository's working directory.
 *
 * @param workDir - The repository working directory
 * @param manifest - The manifest to save
 */
export function saveManifest(workDir: string, manifest: XfgManifest): void {
  const manifestPath = join(workDir, MANIFEST_FILENAME);
  const content = JSON.stringify(manifest, null, 2) + "\n";
  writeFileSync(manifestPath, content, "utf-8");
}

/**
 * Gets the list of managed files for a specific config from a manifest.
 * Returns an empty array if the manifest is null or the config isn't found.
 *
 * @param manifest - The manifest or null
 * @param configId - The config ID to get files for
 * @returns Array of managed file names for the given config
 */
export function getManagedFiles(
  manifest: XfgManifest | null,
  configId: string
): string[] {
  if (!manifest) {
    return [];
  }
  return [...(manifest.configs[configId]?.files ?? [])];
}

/**
 * Updates the manifest with the current set of files that have deleteOrphaned enabled
 * for a specific config. Only modifies that config's files namespace - other configs are untouched.
 *
 * Files with deleteOrphaned: true are added to managedFiles.
 * Files with deleteOrphaned: false (explicit) are removed from managedFiles.
 * Files not in the config but in managedFiles for this configId are candidates for deletion.
 *
 * @param manifest - The existing manifest (or null for new repos)
 * @param configId - The config ID to update
 * @param filesWithDeleteOrphaned - Map of fileName to deleteOrphaned value (true/false/undefined)
 * @returns Updated manifest and list of files to delete
 */
export function updateManifest(
  manifest: XfgManifest | null,
  configId: string,
  filesWithDeleteOrphaned: Map<string, boolean | undefined>
): { manifest: XfgManifest; filesToDelete: string[] } {
  // Get existing managed files for this config only
  const existingManaged = new Set(getManagedFiles(manifest, configId));
  const newManaged = new Set<string>();
  const filesToDelete: string[] = [];

  // Process current config files
  for (const [fileName, deleteOrphaned] of filesWithDeleteOrphaned) {
    if (deleteOrphaned === true) {
      // File has deleteOrphaned: true, add to managed set
      newManaged.add(fileName);
    }
    // If deleteOrphaned is false or undefined, don't add to managed set
    // (explicitly setting false removes from tracking)
  }

  // Find orphaned files: in old manifest for this config but not in current config
  for (const fileName of existingManaged) {
    if (!filesWithDeleteOrphaned.has(fileName)) {
      // File was managed before but is no longer in config - delete it
      filesToDelete.push(fileName);
    }
  }

  // Build updated manifest, preserving other configs
  const updatedConfigs: Record<string, XfgManifestConfigEntry> = {
    ...(manifest?.configs ?? {}),
  };

  // Update this config's managed files
  const sortedManaged = Array.from(newManaged).sort();
  if (sortedManaged.length > 0) {
    updatedConfigs[configId] = { files: sortedManaged };
  } else {
    delete updatedConfigs[configId];
  }

  return {
    manifest: {
      version: 4,
      configs: updatedConfigs,
    },
    filesToDelete,
  };
}
