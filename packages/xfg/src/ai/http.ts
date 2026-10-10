import type { RateLimitedError } from "../shared/errors.js";
import { parseApiJson } from "../shared/json-utils.js";
import { isPlainObject, toErrorMessage } from "../shared/type-guards.js";
import type { FetchFn } from "./types.js";

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_ERROR_BODY_CHARS = 500;

export function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function httpError(label: string, response: Response, text: string): Error {
  const detail = text.slice(0, MAX_ERROR_BODY_CHARS);
  if (response.status !== 429) {
    // Status code in the message lets withRetry classify 5xx as transient.
    return new Error(`${label} ${response.status}: ${detail}`);
  }
  // "rate limit" in the message routes this to withRetry's rate-limit backoff.
  const error: Error & RateLimitedError = new Error(
    `${label} 429 (rate limit): ${detail}`
  );
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter && /^\d+$/.test(retryAfter.trim())) {
    error.retryAfter = parseInt(retryAfter, 10);
  }
  return error;
}

// fetch hides the reason (refused, DNS, connect timeout) in `cause`.
function networkError(label: string, error: unknown): Error {
  const message = toErrorMessage(error);
  const cause = error instanceof Error ? error.cause : undefined;
  const code = isPlainObject(cause) ? cause.code : undefined;
  const detail = typeof code === "string" ? `${message} (${code})` : message;
  return new Error(`${label} request failed: ${detail}`);
}

export async function postJson(
  fetch: FetchFn,
  label: string,
  url: string,
  headers: Record<string, string>,
  body: unknown
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      // Custom headers would follow a cross-origin redirect.
      redirect: "error",
    });
  } catch (error) {
    throw networkError(label, error);
  }
  const text = await response.text();
  if (!response.ok) {
    throw httpError(label, response, text);
  }
  return parseApiJson<unknown>(text, `${label} response`);
}
