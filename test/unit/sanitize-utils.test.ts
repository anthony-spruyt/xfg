import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { sanitizeCredentials } from "../../src/shared/sanitize-utils.js";

describe("sanitizeCredentials", () => {
  test("sanitizes x-access-token in URLs", () => {
    const input =
      "fatal: unable to access 'https://x-access-token:ghp_abc123@github.com/owner/repo/': The requested URL returned error: 401";
    const result = sanitizeCredentials(input);
    assert.equal(
      result,
      "fatal: unable to access 'https://x-access-token:***@github.com/owner/repo/': The requested URL returned error: 401"
    );
  });

  test("sanitizes oauth2 tokens in GitLab URLs", () => {
    const input =
      "Cloning into '.'... fatal: Authentication failed for 'https://oauth2:glpat-xxxx@gitlab.com/owner/repo.git/'";
    const result = sanitizeCredentials(input);
    assert.equal(
      result,
      "Cloning into '.'... fatal: Authentication failed for 'https://oauth2:***@gitlab.com/owner/repo.git/'"
    );
  });

  test("sanitizes pat username in Azure DevOps URLs", () => {
    const input =
      "error: could not lock config file https://pat:ado-token-here@dev.azure.com/org/project/_git/repo";
    const result = sanitizeCredentials(input);
    assert.equal(
      result,
      "error: could not lock config file https://pat:***@dev.azure.com/org/project/_git/repo"
    );
  });

  test("sanitizes multiple credentials in same message", () => {
    const input =
      "Tried https://x-access-token:abc@host1.com and https://oauth2:def@host2.com";
    const result = sanitizeCredentials(input);
    assert.equal(
      result,
      "Tried https://x-access-token:***@host1.com and https://oauth2:***@host2.com"
    );
  });

  test("preserves messages without credentials", () => {
    const input = "fatal: repository 'https://github.com/owner/repo' not found";
    const result = sanitizeCredentials(input);
    assert.equal(result, input);
  });

  test("handles empty string", () => {
    assert.equal(sanitizeCredentials(""), "");
  });

  test("handles undefined/null gracefully", () => {
    assert.equal(sanitizeCredentials(undefined as unknown as string), "");
    assert.equal(sanitizeCredentials(null as unknown as string), "");
  });

  test("sanitizes Bearer tokens in headers", () => {
    const input = "Authorization: Bearer ghp_abc123xyz";
    const result = sanitizeCredentials(input);
    assert.equal(result, "Authorization: Bearer ***");
  });

  test("sanitizes Basic auth headers", () => {
    const input = "Authorization: Basic dXNlcjpwYXNz";
    const result = sanitizeCredentials(input);
    assert.equal(result, "Authorization: Basic ***");
  });
});
