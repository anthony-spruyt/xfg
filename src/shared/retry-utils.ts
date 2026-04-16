import pRetry, { AbortError } from "p-retry";
import { sanitizeCredentials } from "../vcs/sanitize-utils.js";
import { ValidationError } from "./errors.js";

/**
 * Core permanent error patterns shared across all strategies (API, GraphQL, CLI).
 * Auth failures, permission issues, and resource-not-found errors.
 */
export const CORE_PERMANENT_ERROR_PATTERNS: RegExp[] = [
  /permission\s*denied/i,
  /not\s*accessible\s*by\s*integration/i,
  /authentication\s*failed/i,
  /bad\s*credentials/i,
  /invalid\s*(token|credentials)/i,
  /unauthorized/i,
  /401\b/,
  /403\b/,
  /404\b/,
  /422\b/,
  /not\s*found/i,
  /does\s*not\s*exist/i,
  /repository\s*not\s*found/i,
  /set\s+the\s+GH_TOKEN\s+environment\s+variable/i,
  /GITHUB_TOKEN\s+environment\s+variable/i,
  /set\s+the\s+AZURE_DEVOPS_EXT_PAT\s+environment\s+variable/i,
  /GITLAB_TOKEN\s+environment\s+variable/i,
];

/**
 * Default patterns indicating permanent errors that should NOT be retried.
 * Extends CORE_PERMANENT_ERROR_PATTERNS with git-CLI-specific patterns.
 */
export const DEFAULT_PERMANENT_ERROR_PATTERNS: RegExp[] = [
  ...CORE_PERMANENT_ERROR_PATTERNS,
  /no\s*such\s*(file|directory|remote|ref)/i,
  /couldn't\s*find\s*remote\s*ref/i,
  /invalid\s*remote/i,
  /not\s*a\s*git\s*repository/i,
  /non-fast-forward/i,
  /remote\s*rejected/i,
];

/**
 * Default patterns indicating transient errors that SHOULD be retried.
 * These typically indicate temporary network or service issues.
 * Export allows customization for different environments.
 */
const DEFAULT_TRANSIENT_ERROR_PATTERNS: RegExp[] = [
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

/**
 * Patterns that specifically indicate rate limiting (a subset of transient errors).
 * Used to apply longer backoff delays -- connection resets and 5xx errors
 * should NOT get 60-second waits.
 */
const RATE_LIMIT_PATTERNS: RegExp[] = [
  /rate\s*limit/i,
  /too\s*many\s*requests/i,
  /abuse\s*detection/i,
];

/**
 * Checks if an error specifically indicates a rate limit (not just any transient error).
 * Rate limit errors need longer backoff (60s+) compared to network errors (1-4s).
 */
export function isRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const stderr =
    (error as { stderr?: string | Buffer }).stderr?.toString() ?? "";
  const combined = `${message} ${stderr}`;

  for (const pattern of RATE_LIMIT_PATTERNS) {
    if (pattern.test(combined)) {
      return true;
    }
  }

  return false;
}

/** Default delay (seconds) for rate limit errors when no Retry-After header is available. */
const RATE_LIMIT_FALLBACK_DELAY_SECONDS = 60;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface RetryOptions {
  /** Maximum number of retries (default: 3) */
  retries?: number;
  /** Callback when a retry attempt fails */
  onRetry?: (error: Error, attempt: number) => void;
  /** Custom permanent error patterns (defaults to DEFAULT_PERMANENT_ERROR_PATTERNS) */
  permanentErrorPatterns?: RegExp[];
  /** Custom transient error patterns (defaults to DEFAULT_TRANSIENT_ERROR_PATTERNS) */
  transientErrorPatterns?: RegExp[];
  /** Logger for retry messages (defaults to no logging) */
  log?: { info(msg: string): void };
  /** Override for delay function (test injection) */
  _delay?: (ms: number) => Promise<void>;
}

/**
 * Classifies an error as permanent (should not retry) or transient (should retry).
 */
export function isPermanentError(
  error: unknown,
  patterns: RegExp[] = DEFAULT_PERMANENT_ERROR_PATTERNS
): boolean {
  // Validation errors are always permanent — no point retrying bad input
  if (error instanceof ValidationError) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error ?? "");
  const stderr =
    (error as { stderr?: string | Buffer }).stderr?.toString() ?? "";
  const combined = `${message} ${stderr}`;

  // Check permanent patterns first - these always stop retries
  for (const pattern of patterns) {
    if (pattern.test(combined)) {
      return true;
    }
  }

  return false;
}

/**
 * Checks if an error matches known transient patterns.
 */
export function isTransientError(
  error: unknown,
  patterns: RegExp[] = DEFAULT_TRANSIENT_ERROR_PATTERNS
): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const stderr =
    (error as { stderr?: string | Buffer }).stderr?.toString() ?? "";
  const combined = `${message} ${stderr}`;

  for (const pattern of patterns) {
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
 * @throws The original error for permanent failures (pRetry unwraps AbortError before propagating), or the last transient error after all retries exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const retries = options?.retries ?? 3;
  const permanentPatterns = options?.permanentErrorPatterns;

  return pRetry(
    async () => {
      try {
        return await fn();
      } catch (error) {
        if (
          error instanceof Error &&
          !isTransientError(error, options?.transientErrorPatterns) &&
          isPermanentError(error, permanentPatterns)
        ) {
          // Wrap in AbortError to stop retrying immediately
          throw new AbortError(error);
        }
        throw error;
      }
    },
    {
      retries,
      onFailedAttempt: async (context) => {
        // Apply rate-limit-specific delay before the next retry
        if (context.retriesLeft > 0 && isRateLimitError(context.error)) {
          const retryAfterSeconds =
            (context.error as { retryAfter?: number }).retryAfter ??
            RATE_LIMIT_FALLBACK_DELAY_SECONDS;
          options?.log?.info(
            `Rate limited. Waiting ${retryAfterSeconds}s before retry...`
          );
          await (options?._delay ?? delay)(retryAfterSeconds * 1000);
        }

        // Log the failure (existing behavior)
        if (context.retriesLeft > 0) {
          const msg =
            sanitizeCredentials(context.error.message) || "Unknown error";
          options?.log?.info(
            `Attempt ${context.attemptNumber}/${retries + 1} failed: ${msg}. Retrying...`
          );
          options?.onRetry?.(context.error, context.attemptNumber);
        }
      },
    }
  );
}
