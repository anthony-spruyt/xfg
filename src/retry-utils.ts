import pRetry, { AbortError } from "p-retry";
import { logger } from "./logger.js";

/**
 * Patterns indicating permanent errors that should NOT be retried.
 * These typically indicate configuration issues, auth failures, or invalid resources.
 */
const PERMANENT_ERROR_PATTERNS = [
  /permission\s*denied/i,
  /authentication\s*failed/i,
  /bad\s*credentials/i,
  /invalid\s*(token|credentials)/i,
  /unauthorized/i,
  /401\b/,
  /403\b/,
  /404\b/,
  /not\s*found/i,
  /does\s*not\s*exist/i,
  /repository\s*not\s*found/i,
  /no\s*such\s*(file|directory|remote|ref)/i,
  /invalid\s*remote/i,
  /not\s*a\s*git\s*repository/i,
  /non-fast-forward/i,
  /remote\s*rejected/i,
];

/**
 * Patterns indicating transient errors that SHOULD be retried.
 * These typically indicate temporary network or service issues.
 */
const TRANSIENT_ERROR_PATTERNS = [
  /timed?\s*out/i,
  /ETIMEDOUT/,
  /ECONNRESET/,
  /ECONNREFUSED/,
  /ENOTFOUND/,
  /connection\s*(reset|refused|closed)/i,
  /network\s*(error|unreachable)/i,
  /rate\s*limit/i,
  /too\s*many\s*requests/i,
  /429\b/,
  /500\b/,
  /502\b/,
  /503\b/,
  /504\b/,
  /service\s*unavailable/i,
  /temporarily\s*unavailable/i,
  /internal\s*server\s*error/i,
  /temporary\s*(failure|error)/i,
  /try\s*again/i,
  /ssh_exchange_identification/i,
  /could\s*not\s*resolve\s*host/i,
  /unable\s*to\s*access/i,
];

export interface RetryOptions {
  /** Maximum number of retries (default: 3) */
  retries?: number;
  /** Callback when a retry attempt fails */
  onRetry?: (error: Error, attempt: number) => void;
}

/**
 * Classifies an error as permanent (should not retry) or transient (should retry).
 * @param error The error to classify
 * @returns true if the error is permanent, false if it might be transient
 */
export function isPermanentError(error: Error): boolean {
  const message = error.message;
  const stderr =
    (error as { stderr?: string | Buffer }).stderr?.toString() ?? "";
  const combined = `${message} ${stderr}`;

  // Check permanent patterns first - these always stop retries
  for (const pattern of PERMANENT_ERROR_PATTERNS) {
    if (pattern.test(combined)) {
      return true;
    }
  }

  return false;
}

/**
 * Checks if an error matches known transient patterns.
 * @param error The error to check
 * @returns true if the error appears to be transient
 */
export function isTransientError(error: Error): boolean {
  const message = error.message;
  const stderr =
    (error as { stderr?: string | Buffer }).stderr?.toString() ?? "";
  const combined = `${message} ${stderr}`;

  for (const pattern of TRANSIENT_ERROR_PATTERNS) {
    if (pattern.test(combined)) {
      return true;
    }
  }

  return false;
}

/**
 * Wraps an async operation with retry logic using exponential backoff.
 * Automatically classifies errors and aborts retries for permanent failures.
 *
 * @param fn The async function to run with retry
 * @param options Retry configuration options
 * @returns The result of the function if successful
 * @throws AbortError for permanent failures, or the last error after all retries exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const retries = options?.retries ?? 3;

  return pRetry(
    async () => {
      try {
        return await fn();
      } catch (error) {
        if (error instanceof Error && isPermanentError(error)) {
          // Wrap in AbortError to stop retrying immediately
          throw new AbortError(error.message);
        }
        throw error;
      }
    },
    {
      retries,
      onFailedAttempt: (context) => {
        // Only log if this isn't the last attempt
        if (context.retriesLeft > 0) {
          const msg = context.error.message || "Unknown error";
          logger.info(
            `Attempt ${context.attemptNumber}/${retries + 1} failed: ${msg}. Retrying...`,
          );
          options?.onRetry?.(context.error, context.attemptNumber);
        }
      },
    },
  );
}

/**
 * Wraps a synchronous operation in a Promise for use with retry logic.
 * @param fn The sync function to run
 * @returns A Promise that resolves/rejects with the sync result
 */
export function promisify<T>(fn: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      resolve(fn());
    } catch (error) {
      reject(error);
    }
  });
}

// Re-export AbortError for use in custom error handling
export { AbortError } from "p-retry";
