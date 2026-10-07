import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  isRateLimitText,
  isTransientErrorText,
} from "../../integration/test-helpers.js";

// "1759842942901" contains "429" and "1759403500123" contains "403" and "500",
// the shape generateRepoName() produces from Date.now().
const REPO_WITH_429 = "spruyt-labs/xfg-lifecycle-test-1759842942901-a1b2c3";
const REPO_WITH_403_500 = "spruyt-labs/xfg-sync-test-1759403500123-0f9e8d";

const NOT_FOUND_ERRORS = [
  `Command failed: sh -c gh api repos/${REPO_WITH_429}\ngh: Not Found (HTTP 404)`,
  `Command failed: sh -c gh api repos/${REPO_WITH_429}/vulnerability-alerts\ngh: Not Found (HTTP 404)`,
  `Command failed: sh -c gh api -X POST repos/${REPO_WITH_403_500}/generate\ngh: Not Found (HTTP 404)`,
];

const RATE_LIMIT_ERRORS = {
  "HTTP 429 status": "Command failed: sh -c curl ...\nHTTP 429",
  "HTTP/2 429 status line": "HTTP/2.0 429 Too Many Requests\nRetry-After: 30",
  "status: 429": "Request failed with status: 429",
  "API rate limit exceeded":
    "gh: API rate limit exceeded for user ID 12345. (HTTP 403)",
  "secondary rate limit":
    "gh: You have exceeded a secondary rate limit. Please wait a few minutes before you try again. (HTTP 403)",
  "HTTP 403 with rate-limit message":
    "HTTP 403: API rate limit exceeded for installation ID 67890.",
};

describe("isRateLimitText", () => {
  for (const text of NOT_FOUND_ERRORS) {
    test(`is false for a 404 whose repo name contains 429/403: ${text.split("\n")[0]}`, () => {
      assert.equal(isRateLimitText(text), false);
    });
  }

  test("is false for a 403 permission error without rate-limit text", () => {
    assert.equal(
      isRateLimitText("gh: Must have admin rights to Repository. (HTTP 403)"),
      false
    );
  });

  for (const [name, text] of Object.entries(RATE_LIMIT_ERRORS)) {
    test(`is true for ${name}`, () => {
      assert.equal(isRateLimitText(text), true);
    });
  }
});

describe("isTransientErrorText", () => {
  for (const text of NOT_FOUND_ERRORS) {
    test(`is false for a 404 whose repo name contains 429/403/500: ${text.split("\n")[0]}`, () => {
      assert.equal(isTransientErrorText(text), false);
    });
  }

  for (const [name, text] of Object.entries(RATE_LIMIT_ERRORS)) {
    test(`is true for ${name}`, () => {
      assert.equal(isTransientErrorText(text), true);
    });
  }

  for (const text of [
    "gh: Server Error (HTTP 500)",
    "HTTP 502: Bad Gateway",
    "gh: HTTP 503",
    "Command failed: sh -c curl ...\nHTTP 504",
    "<html><head><title>502 Bad Gateway</title></head></html>",
    "curl: (22) The requested URL returned error: 503\nerror code: 503HTTP 503",
  ]) {
    test(`is true for 5xx: ${text}`, () => {
      assert.equal(isTransientErrorText(text), true);
    });
  }

  test("is true for a curl -w status glued to the response body", () => {
    assert.equal(isTransientErrorText("Retry laterHTTP 429"), true);
    assert.equal(isRateLimitText("Retry laterHTTP 429"), true);
  });

  test("is false for HTTP 501 Not Implemented", () => {
    assert.equal(isTransientErrorText("gh: Not Implemented (HTTP 501)"), false);
  });
});
