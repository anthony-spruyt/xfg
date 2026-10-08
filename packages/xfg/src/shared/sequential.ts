/** Runs `task` for each item one at a time, stopping at the first rejection. */
export function runSequentially<T>(
  items: readonly T[],
  task: (item: T) => Promise<void>
): Promise<void> {
  return items.reduce<Promise<void>>(
    (chain, item) => chain.then(() => task(item)),
    Promise.resolve()
  );
}
