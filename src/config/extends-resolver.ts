import type { RawGroupConfig } from "./types.js";

const MAX_EXTENDS_DEPTH = 100;

/**
 * Resolves a single group's extends chain into an ordered list of group names.
 * Parents appear before children (topological order). Detects circular extends
 * and missing group references.
 */
export function resolveExtendsChain(
  groupName: string,
  groupDefs: Record<string, RawGroupConfig>
): string[] {
  function walk(name: string, visited: Set<string>, depth: number): string[] {
    if (depth > MAX_EXTENDS_DEPTH) {
      throw new Error(
        `Extends chain exceeds maximum depth of ${MAX_EXTENDS_DEPTH} — likely misconfigured`
      );
    }

    if (visited.has(name)) {
      const cycle = [...visited, name].join(" -> ");
      throw new Error(`Circular extends detected: ${cycle}`);
    }
    visited.add(name);

    const group = groupDefs[name];
    if (!group) {
      throw new Error(
        `Group '${name}' referenced in extends chain does not exist`
      );
    }

    if (!group.extends) {
      return [name];
    }

    const parents = Array.isArray(group.extends)
      ? group.extends
      : [group.extends];

    const result: string[] = [];
    const seen = new Set<string>();

    for (const parent of parents) {
      const chain = walk(parent, new Set(visited), depth + 1);
      for (const n of chain) {
        if (!seen.has(n)) {
          seen.add(n);
          result.push(n);
        }
      }
    }

    if (!seen.has(name)) {
      result.push(name);
    }

    return result;
  }

  return walk(groupName, new Set(), 0);
}

/**
 * Expands a repo's group list by resolving extends chains for each group.
 * Returns the full ordered list with transitive parents, deduplicated.
 * First occurrence wins for deduplication (preserves topological order).
 */
export function expandRepoGroups(
  repoGroups: string[],
  groupDefs: Record<string, RawGroupConfig>
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const groupName of repoGroups) {
    const chain = resolveExtendsChain(groupName, groupDefs);
    for (const name of chain) {
      if (!seen.has(name)) {
        seen.add(name);
        result.push(name);
      }
    }
  }

  return result;
}
