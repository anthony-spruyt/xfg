import { describe, test } from "node:test";
import assert from "node:assert";
import { escapeShellArg } from "../../src/shell-utils.js";

describe("escapeShellArg", () => {
  describe("basic escaping", () => {
    test("wraps simple string in single quotes", () => {
      assert.strictEqual(escapeShellArg("hello"), "'hello'");
    });

    test("handles empty string", () => {
      assert.strictEqual(escapeShellArg(""), "''");
    });

    test("handles string with spaces", () => {
      assert.strictEqual(escapeShellArg("hello world"), "'hello world'");
    });

    test("handles string with multiple spaces", () => {
      assert.strictEqual(
        escapeShellArg("one  two   three"),
        "'one  two   three'"
      );
    });
  });

  describe("single quote escaping", () => {
    test("escapes single quote in middle of string", () => {
      // 'don't' becomes 'don'\''t'
      assert.strictEqual(escapeShellArg("don't"), "'don'\\''t'");
    });

    test("escapes multiple single quotes", () => {
      assert.strictEqual(
        escapeShellArg("it's a 'test'"),
        "'it'\\''s a '\\''test'\\'''"
      );
    });

    test("escapes single quote at start", () => {
      assert.strictEqual(escapeShellArg("'start"), "''\\''start'");
    });

    test("escapes single quote at end", () => {
      assert.strictEqual(escapeShellArg("end'"), "'end'\\'''");
    });

    test("handles string of only single quotes", () => {
      assert.strictEqual(escapeShellArg("'''"), "''\\'''\\'''\\'''");
    });
  });

  describe("special characters", () => {
    test("handles double quotes (no special escaping needed)", () => {
      assert.strictEqual(escapeShellArg('say "hello"'), "'say \"hello\"'");
    });

    test("handles backticks (no command substitution in single quotes)", () => {
      assert.strictEqual(escapeShellArg("`whoami`"), "'`whoami`'");
    });

    test("handles dollar sign (no variable expansion in single quotes)", () => {
      assert.strictEqual(escapeShellArg("$HOME"), "'$HOME'");
    });

    test("handles backslash", () => {
      assert.strictEqual(escapeShellArg("path\\to\\file"), "'path\\to\\file'");
    });

    test("handles newlines", () => {
      assert.strictEqual(escapeShellArg("line1\nline2"), "'line1\nline2'");
    });

    test("handles tabs", () => {
      assert.strictEqual(escapeShellArg("col1\tcol2"), "'col1\tcol2'");
    });

    test("handles semicolons (prevents command chaining)", () => {
      assert.strictEqual(escapeShellArg("test; rm -rf /"), "'test; rm -rf /'");
    });

    test("handles pipes (prevents piping)", () => {
      assert.strictEqual(
        escapeShellArg("test | cat /etc/passwd"),
        "'test | cat /etc/passwd'"
      );
    });

    test("handles ampersands (prevents background execution)", () => {
      assert.strictEqual(
        escapeShellArg("test & malicious"),
        "'test & malicious'"
      );
    });

    test("handles parentheses (prevents subshell)", () => {
      assert.strictEqual(escapeShellArg("$(whoami)"), "'$(whoami)'");
    });

    test("handles angle brackets (prevents redirection)", () => {
      assert.strictEqual(
        escapeShellArg("test > /etc/passwd"),
        "'test > /etc/passwd'"
      );
    });
  });

  describe("git-related strings", () => {
    test("handles git branch names", () => {
      assert.strictEqual(
        escapeShellArg("feature/my-branch"),
        "'feature/my-branch'"
      );
    });

    test("handles commit messages", () => {
      assert.strictEqual(
        escapeShellArg("fix: resolve issue with 'quotes'"),
        "'fix: resolve issue with '\\''quotes'\\'''"
      );
    });

    test("handles git URLs with special chars", () => {
      assert.strictEqual(
        escapeShellArg("git@github.com:org/repo.git"),
        "'git@github.com:org/repo.git'"
      );
    });

    test("handles HTTPS URLs", () => {
      assert.strictEqual(
        escapeShellArg("https://github.com/org/repo.git"),
        "'https://github.com/org/repo.git'"
      );
    });
  });

  describe("security edge cases", () => {
    test("prevents command injection via single quotes", () => {
      // Attacker tries: '; rm -rf / #
      const malicious = "'; rm -rf / #";
      const escaped = escapeShellArg(malicious);
      // Single quote becomes '\'' - safe within single quotes
      // Output: ''\''; rm -rf / #'
      assert.strictEqual(escaped, "''\\''; rm -rf / #'");
    });

    test("prevents command injection via backticks", () => {
      const malicious = "`cat /etc/passwd`";
      const escaped = escapeShellArg(malicious);
      // Backticks are safe within single quotes
      assert.strictEqual(escaped, "'`cat /etc/passwd`'");
    });

    test("prevents command injection via $(...)", () => {
      const malicious = "$(cat /etc/passwd)";
      const escaped = escapeShellArg(malicious);
      assert.strictEqual(escaped, "'$(cat /etc/passwd)'");
    });

    test("throws on null bytes", () => {
      const withNull = "test\x00injected";
      assert.throws(() => escapeShellArg(withNull), {
        message: "Shell argument contains null byte",
      });
    });
  });
});
