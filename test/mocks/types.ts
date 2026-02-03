export interface MockCallTracker<T> {
  mock: T;
  calls: Record<string, Array<{ args: unknown[]; result?: unknown }>>;
  reset: () => void;
}
