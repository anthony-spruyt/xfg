import { describe, test } from "node:test";
import assert from "node:assert";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { escapeShellArg, formatPRBody } from "./pr-creator.js";

describe("escapeShellArg", () => {
  test("wraps simple strings in single quotes", () => {
    assert.strictEqual(escapeShellArg("hello"), "'hello'");
  });

  test("escapes embedded single quotes", () => {
    // Input: it's a test
    // Expected: 'it'\''s a test'
    assert.strictEqual(escapeShellArg("it's a test"), "'it'\\''s a test'");
  });

  test("handles empty strings", () => {
    assert.strictEqual(escapeShellArg(""), "''");
  });

  test("handles strings with spaces", () => {
    assert.strictEqual(escapeShellArg("hello world"), "'hello world'");
  });

  test("handles strings with newlines", () => {
    assert.strictEqual(escapeShellArg("hello\nworld"), "'hello\nworld'");
  });

  test("handles strings with shell metacharacters: | & ; $ ` \\", () => {
    // These should be safely wrapped in single quotes
    assert.strictEqual(escapeShellArg("cmd | other"), "'cmd | other'");
    assert.strictEqual(escapeShellArg("cmd && other"), "'cmd && other'");
    assert.strictEqual(escapeShellArg("cmd; other"), "'cmd; other'");
    assert.strictEqual(escapeShellArg("$HOME"), "'$HOME'");
    assert.strictEqual(escapeShellArg("`whoami`"), "'`whoami`'");
    assert.strictEqual(escapeShellArg("path\\to\\file"), "'path\\to\\file'");
  });

  test("handles strings with double quotes", () => {
    assert.strictEqual(escapeShellArg('say "hello"'), "'say \"hello\"'");
  });

  test("handles strings with multiple single quotes", () => {
    // Input: it's Alice's book
    // Expected: 'it'\''s Alice'\''s book'
    assert.strictEqual(
      escapeShellArg("it's Alice's book"),
      "'it'\\''s Alice'\\''s book'",
    );
  });

  test("handles command injection attempt via backticks", () => {
    const malicious = "Fix bug `whoami`";
    const escaped = escapeShellArg(malicious);
    // The backticks are safely contained in single quotes
    assert.strictEqual(escaped, "'Fix bug `whoami`'");
  });

  test("handles command injection attempt via $()", () => {
    const malicious = "Update $(cat /etc/passwd)";
    const escaped = escapeShellArg(malicious);
    // The $() is safely contained in single quotes
    assert.strictEqual(escaped, "'Update $(cat /etc/passwd)'");
  });

  test("handles git URL with embedded malicious content", () => {
    const malicious = 'https://github.com/org/repo.git"; rm -rf /';
    const escaped = escapeShellArg(malicious);
    // The entire string is safely quoted
    assert.strictEqual(
      escaped,
      "'https://github.com/org/repo.git\"; rm -rf /'",
    );
  });
});

describe("formatPRBody", () => {
  test("replaces {{FILE_NAME}} placeholder", () => {
    const result = formatPRBody("config.json", "create");
    assert.ok(result.includes("config.json"));
    assert.ok(!result.includes("{{FILE_NAME}}"));
  });

  test('replaces {{ACTION}} placeholder with "Created" for create action', () => {
    const result = formatPRBody("config.json", "create");
    assert.ok(result.includes("Created"));
    assert.ok(!result.includes("{{ACTION}}"));
  });

  test('replaces {{ACTION}} placeholder with "Updated" for update action', () => {
    const result = formatPRBody("config.json", "update");
    assert.ok(result.includes("Updated"));
    assert.ok(!result.includes("{{ACTION}}"));
  });

  test("preserves markdown formatting", () => {
    const result = formatPRBody("config.json", "create");
    // Should contain markdown headers or formatting
    assert.ok(result.includes("##") || result.includes("*"));
  });

  test("handles multiple occurrences of placeholders", () => {
    const result = formatPRBody("test.yaml", "update");
    // Count occurrences of the file name
    const fileNameOccurrences = (result.match(/test\.yaml/g) || []).length;
    // Should replace all occurrences (at least 1)
    assert.ok(fileNameOccurrences >= 1);
    // Should not contain any unreplaced placeholders
    assert.ok(!result.includes("{{"));
    assert.ok(!result.includes("}}"));
  });
});

describe("loadPRTemplate (via formatPRBody)", () => {
  // Get the expected path for PR.md
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const templatePath = join(__dirname, "..", "PR.md");

  test("loads PR.md template when file exists", () => {
    // Verify PR.md exists in the project
    assert.ok(
      existsSync(templatePath),
      `PR.md should exist at ${templatePath}`,
    );

    // formatPRBody should use content from PR.md
    const result = formatPRBody("config.json", "create");

    // The actual PR.md has specific content we can verify
    // It should contain markdown formatting from the template
    assert.ok(result.length > 50, "Template should have substantial content");
  });

  test("template contains expected sections", () => {
    const result = formatPRBody("config.json", "create");

    // PR.md should have summary section and automation note
    assert.ok(
      result.includes("json-config-sync") ||
        result.includes("Summary") ||
        result.includes("Changes"),
      "Template should have expected sections",
    );
  });

  test("fallback template structure is valid", () => {
    // The fallback template (in case PR.md is missing) has a specific structure
    // We verify by checking that formatPRBody always returns valid content
    const result = formatPRBody("test.json", "create");

    // Should have the filename
    assert.ok(result.includes("test.json"));

    // Should have the action text
    assert.ok(result.includes("Created"));

    // Should have some structure (markdown headers or bullets)
    assert.ok(
      result.includes("#") || result.includes("-") || result.includes("*"),
      "Should have markdown formatting",
    );
  });
});
