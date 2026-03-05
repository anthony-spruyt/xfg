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
