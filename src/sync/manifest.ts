import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { toErrorMessage, isPlainObject } from "../shared/type-guards.js";
import { SyncError } from "../shared/errors.js";
import type { DebugWarnLog } from "../shared/logger.js";

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

function hasVersion(manifest: unknown, version: number): boolean {
  return (
    isPlainObject(manifest) &&
    (manifest as { version: number }).version === version
  );
}

function isV1Manifest(manifest: unknown): manifest is XfgManifestV1 {
  return (
    hasVersion(manifest, 1) &&
    Array.isArray((manifest as XfgManifestV1).managedFiles)
  );
}

function hasConfigs(manifest: unknown): boolean {
  return isPlainObject((manifest as { configs: unknown }).configs);
}

function isV2Manifest(manifest: unknown): manifest is XfgManifestV2 {
  return hasVersion(manifest, 2) && hasConfigs(manifest);
}

function isV3Manifest(manifest: unknown): manifest is XfgManifestV3 {
  return hasVersion(manifest, 3) && hasConfigs(manifest);
}

function isV4Manifest(manifest: unknown): manifest is XfgManifest {
  return hasVersion(manifest, 4) && hasConfigs(manifest);
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
 * Migrates a parsed manifest to V4 if recognized (V2/V3/V4).
 * Returns null for unrecognized formats.
 */
function migrateToV4(parsed: unknown): XfgManifest | null {
  if (isV4Manifest(parsed)) return parsed;
  if (isV3Manifest(parsed)) return migrateV3ToV4(parsed);
  if (isV2Manifest(parsed)) return migrateV3ToV4(migrateV2ToV3(parsed));
  return null;
}

export function createEmptyManifest(): XfgManifest {
  return {
    version: 4,
    configs: {},
  };
}

/**
 * Loads and migrates manifest from workDir. V1 returns null (no config-ID namespace);
 * V2/V3 are auto-migrated to V4.
 */
export function loadManifest(
  workDir: string,
  log?: DebugWarnLog
): XfgManifest | null {
  const manifestPath = join(workDir, MANIFEST_FILENAME);

  if (!existsSync(manifestPath)) {
    return null;
  }

  try {
    const content = readFileSync(manifestPath, "utf-8");
    const parsed = JSON.parse(content) as unknown;

    const migrated = migrateToV4(parsed);
    if (migrated) return migrated;

    // V1 manifest - treat as no manifest (will be overwritten with v4)
    if (isV1Manifest(parsed)) {
      return null;
    }

    // Unknown format
    log?.warn(`Unrecognized manifest format in ${manifestPath}, ignoring`);
    return null;
  } catch (error) {
    log?.warn(
      `Failed to parse manifest ${manifestPath}: ${toErrorMessage(error)}`
    );
    return null;
  }
}

/**
 * Parses manifest content from a string (e.g., fetched from a remote API).
 * Handles V2/V3 → V4 migration, returns null for V1/unknown/invalid formats.
 */
export function parseManifestContent(
  content: string,
  log?: DebugWarnLog
): XfgManifest | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    return migrateToV4(parsed);
  } catch (error) {
    log?.warn(`Failed to parse manifest content: ${toErrorMessage(error)}`);
    return null;
  }
}

export function saveManifest(workDir: string, manifest: XfgManifest): void {
  const manifestPath = join(workDir, MANIFEST_FILENAME);
  const content = JSON.stringify(manifest, null, 2) + "\n";
  try {
    writeFileSync(manifestPath, content, "utf-8");
  } catch (error) {
    throw new SyncError(
      `Failed to save manifest ${manifestPath}: ${toErrorMessage(error)}`
    );
  }
}

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
 * Updates manifest tracking for a config. Files with deleteOrphaned: true are tracked;
 * files previously tracked but no longer in config are returned as filesToDelete.
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
  const sortedManaged = Array.from(newManaged).sort((a, b) =>
    a.localeCompare(b)
  );
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
