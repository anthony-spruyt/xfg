/**
 * Formats a summary entry like "3 files (1 to create, 2 to update)".
 * Returns null if total is 0.
 */
export function formatCountEntry(
  noun: string,
  pluralNoun: string,
  counts: { label: string; value: number }[]
): string | null {
  const total = counts.reduce((sum, c) => sum + c.value, 0);
  if (total === 0) return null;

  const word = total === 1 ? noun : pluralNoun;
  const actions = counts
    .filter((c) => c.value > 0)
    .map((c) => `${c.value} ${c.label}`);
  return `${total} ${word} (${actions.join(", ")})`;
}

export interface ActionTotals {
  create: number;
  update: number;
  delete?: number;
}

/**
 * Formats create/update/delete totals, future tense for a plan
 * ("2 to create") and past tense after an apply ("2 created").
 */
export function formatActionCountEntry(
  noun: string,
  pluralNoun: string,
  totals: ActionTotals,
  dryRun: boolean
): string | null {
  return formatCountEntry(noun, pluralNoun, [
    { label: dryRun ? "to create" : "created", value: totals.create },
    { label: dryRun ? "to update" : "updated", value: totals.update },
    { label: dryRun ? "to delete" : "deleted", value: totals.delete ?? 0 },
  ]);
}
