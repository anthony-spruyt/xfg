import { randomUUID } from "node:crypto";

export function generateWorkspaceName(index: number): string {
  const timestamp = Date.now();
  const uuid = randomUUID().slice(0, 8);
  return `repo-${timestamp}-${index}-${uuid}`;
}
