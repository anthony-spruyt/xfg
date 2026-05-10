import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ProcessExecutor,
  ICommandExecutor,
  getStderr,
} from "../../../src/shared/command-executor.js";

describe("ProcessExecutor", () => {
  const executor = new ProcessExecutor(process.env);
  const testDir = join(tmpdir(), `cmd-exec-test-${Date.now()}`);

  test("setup", () => {
    mkdirSync(testDir, { recursive: true });
  });

  test("runs simple command and returns trimmed output", async () => {
    const result = await executor.exec("echo", ["hello"], testDir);
    assert.strictEqual(result, "hello");
  });

  test("trims whitespace from output", async () => {
    const result = await executor.exec("echo", ["  spaced  "], testDir);
    assert.strictEqual(result, "spaced");
  });

  test("runs command in specified working directory", async () => {
    writeFileSync(join(testDir, "test.txt"), "content");
    const result = await executor.exec("ls", ["test.txt"], testDir);
    assert.strictEqual(result, "test.txt");
  });

  test("throws error for non-existent command", async () => {
    await assert.rejects(
      async () => executor.exec("nonexistent_command_xyz", [], testDir),
      /ENOENT|not found/i
    );
  });

  test("throws error for command that exits with non-zero code", async () => {
    await assert.rejects(
      async () => executor.exec("false", [], testDir),
      Error
    );
  });

  test("throws error for invalid working directory", async () => {
    await assert.rejects(
      async () =>
        executor.exec("echo", ["test"], "/nonexistent/directory/path/xyz"),
      Error
    );
  });

  test("handles command with multiple arguments", async () => {
    const result = await executor.exec(
      "echo",
      ["one", "two", "three"],
      testDir
    );
    assert.strictEqual(result, "one two three");
  });

  test("passes stdin input to command", async () => {
    const result = await executor.exec("cat", [], testDir, { input: "hello" });
    assert.strictEqual(result, "hello");
  });

  test("cleanup", () => {
    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("ProcessExecutor with process.env", () => {
  const processEnvExecutor = new ProcessExecutor(process.env);

  test("is an instance of ProcessExecutor", () => {
    assert.ok(processEnvExecutor instanceof ProcessExecutor);
  });

  test("implements ICommandExecutor interface", () => {
    assert.strictEqual(typeof processEnvExecutor.exec, "function");
  });

  test("runs commands successfully", async () => {
    const result = await processEnvExecutor.exec("echo", ["default"], tmpdir());
    assert.strictEqual(result, "default");
  });
});

describe("ICommandExecutor interface", () => {
  test("can be implemented with custom executor", async () => {
    const mockExecutor: ICommandExecutor = {
      async exec(
        _executable: string,
        _args: string[],
        _cwd: string
      ): Promise<string> {
        return "mocked output";
      },
    };

    const result = await mockExecutor.exec("any", [], "/any/path");
    assert.strictEqual(result, "mocked output");
  });

  test("allows tracking of executed commands", async () => {
    const commands: Array<{ executable: string; args: string[]; cwd: string }> =
      [];

    const trackingExecutor: ICommandExecutor = {
      async exec(
        executable: string,
        args: string[],
        cwd: string
      ): Promise<string> {
        commands.push({ executable, args, cwd });
        return "tracked";
      },
    };

    await trackingExecutor.exec("git", ["status"], "/repo");
    await trackingExecutor.exec("git", ["log"], "/repo");

    assert.strictEqual(commands.length, 2);
    assert.strictEqual(commands[0].executable, "git");
    assert.deepStrictEqual(commands[0].args, ["status"]);
    assert.strictEqual(commands[1].executable, "git");
    assert.deepStrictEqual(commands[1].args, ["log"]);
  });
});

describe("credential sanitization", () => {
  test("sanitizes credentials in error messages", async () => {
    const executor = new ProcessExecutor(process.env);

    try {
      await executor.exec(
        "node",
        [
          "-e",
          "console.error('fatal: https://x-access-token:secret@github.com'); process.exit(1)",
        ],
        "."
      );
      assert.fail("Should have thrown");
    } catch (error) {
      const message = (error as Error).message;
      assert.ok(
        !message.includes("secret"),
        "Token should be sanitized from error"
      );
      assert.ok(message.includes("***"), "Token should be replaced with ***");
    }
  });

  test("sanitizes credentials in stderr", async () => {
    const executor = new ProcessExecutor(process.env);

    try {
      await executor.exec(
        "node",
        [
          "-e",
          "console.error('https://oauth2:glpat-xyz@gitlab.com'); process.exit(1)",
        ],
        "."
      );
      assert.fail("Should have thrown");
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr ?? "";
      assert.ok(
        !stderr.includes("glpat-xyz"),
        "Token should be sanitized from stderr"
      );
    }
  });
});

describe("getStderr", () => {
  test("extracts stderr string from error object", () => {
    const error = { stderr: "some error output" };
    assert.strictEqual(getStderr(error), "some error output");
  });

  test("returns empty string when stderr is not a string", () => {
    const error = { stderr: 42 };
    assert.strictEqual(getStderr(error), "");
  });

  test("returns empty string when error has no stderr", () => {
    const error = new Error("fail");
    assert.strictEqual(getStderr(error), "");
  });

  test("returns empty string for null", () => {
    assert.strictEqual(getStderr(null), "");
  });

  test("returns empty string for undefined", () => {
    assert.strictEqual(getStderr(undefined), "");
  });

  test("returns empty string for non-object values", () => {
    assert.strictEqual(getStderr("string"), "");
    assert.strictEqual(getStderr(123), "");
  });
});
