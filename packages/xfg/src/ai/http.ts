import type { FetchFn } from "./types.js";

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_ERROR_BODY_CHARS = 500;

export function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export async function postJson(
  fetch: FetchFn,
  label: string,
  url: string,
  headers: Record<string, string>,
  body: unknown
): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) {
    // Status code in the message lets withRetry classify 429/5xx as transient.
    throw new Error(
      `${label} ${response.status}: ${text.slice(0, MAX_ERROR_BODY_CHARS)}`
    );
  }
  return JSON.parse(text) as unknown;
}
