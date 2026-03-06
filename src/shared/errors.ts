/**
 * Thrown when config validation fails.
 * Distinguishable from I/O errors by type, so callers and retry logic
 * can treat validation failures as permanent without message-parsing.
 */
export class ValidationError extends Error {
  override readonly name = "ValidationError";

  constructor(message: string) {
    super(message);
  }
}

/**
 * Thrown when a GitHub GraphQL API call fails.
 * Standardizes all GraphQL error messages under one type so catch blocks
 * and retry logic can identify them without message-parsing.
 */
export class GraphQLApiError extends Error {
  override readonly name = "GraphQLApiError";

  constructor(message: string) {
    super(message);
  }
}

export class SyncError extends Error {
  override readonly name = "SyncError";

  constructor(message: string) {
    super(message);
  }
}

export class LifecycleError extends Error {
  override readonly name = "LifecycleError";

  constructor(message: string) {
    super(message);
  }
}
