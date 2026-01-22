import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const MANIFEST_FILENAME = ".xfg.json";

export interface XfgManifest {
  version: 1;
  managedFiles: string[];
}

/**
 * Creates an empty manifest with the current version.
 */
export function createEmptyManifest(): XfgManifest {
  return {
    version: 1,
    managedFiles: [],
  };
}

/**
 * Loads the xfg manifest from a repository's working directory.
 * Returns null if the manifest file doesn't exist.
 *
 * @param workDir - The repository working directory
 * @returns The manifest or null if not found
 */
export function loadManifest(workDir: string): XfgManifest | null {
  const manifestPath = join(workDir, MANIFEST_FILENAME);

  if (!existsSync(manifestPath)) {
    return null;
  }

  try {
    const content = readFileSync(manifestPath, "utf-8");
    const parsed = JSON.parse(content) as XfgManifest;

    // Validate the manifest structure
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    if (parsed.version !== 1) {
      return null;
    }

    if (!Array.isArray(parsed.managedFiles)) {
      return null;
    }

    return parsed;
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
 * Gets the list of managed files from a manifest.
 * Returns an empty array if the manifest is null.
 *
 * @param manifest - The manifest or null
 * @returns Array of managed file names
 */
export function getManagedFiles(manifest: XfgManifest | null): string[] {
  if (!manifest) {
    return [];
  }
  return [...manifest.managedFiles];
}

/**
 * Updates the manifest with the current set of files that have deleteOrphaned enabled.
 * Files with deleteOrphaned: true are added to managedFiles.
 * Files with deleteOrphaned: false (explicit) are removed from managedFiles.
 * Files not in the config but in managedFiles are candidates for deletion.
 *
 * @param manifest - The existing manifest (or null for new repos)
 * @param filesWithDeleteOrphaned - Map of fileName to deleteOrphaned value (true/false/undefined)
 * @returns Updated manifest and list of files to delete
 */
export function updateManifest(
  manifest: XfgManifest | null,
  filesWithDeleteOrphaned: Map<string, boolean | undefined>,
): { manifest: XfgManifest; filesToDelete: string[] } {
  const existingManaged = new Set(getManagedFiles(manifest));
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

  // Find orphaned files: in old manifest but not in current config
  for (const fileName of existingManaged) {
    if (!filesWithDeleteOrphaned.has(fileName)) {
      // File was managed before but is no longer in config - delete it
      filesToDelete.push(fileName);
    }
  }

  return {
    manifest: {
      version: 1,
      managedFiles: Array.from(newManaged).sort(),
    },
    filesToDelete,
  };
}
