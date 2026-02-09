import { randomUUID } from "node:crypto";

/**
 * Generates a unique workspace directory name to avoid collisions
 * when multiple CLI instances run concurrently.
 */
export function generateWorkspaceName(index: number): string {
  const timestamp = Date.now();
  const uuid = randomUUID().slice(0, 8);
  return `repo-${timestamp}-${index}-${uuid}`;
}
