/**
 * Tests for command-executor.ts
 * This file tests the existing ICommandExecutor abstraction used for DI in git operations.
 */
import { describe, test } from "node:test";
import assert from "node:assert";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ShellCommandExecutor,
  defaultExecutor,
  ICommandExecutor,
} from "../../src/command-executor.js";

describe("ShellCommandExecutor", () => {
  const executor = new ShellCommandExecutor();
  const testDir = join(tmpdir(), `cmd-exec-test-${Date.now()}`);

  // Setup test directory
  test("setup", () => {
    mkdirSync(testDir, { recursive: true });
  });

  test("runs simple command and returns trimmed output", async () => {
    const result = await executor.exec("echo hello", testDir);
    assert.strictEqual(result, "hello");
  });

  test("trims whitespace from output", async () => {
    const result = await executor.exec("echo '  spaced  '", testDir);
    assert.strictEqual(result, "spaced");
  });

  test("runs command in specified working directory", async () => {
    // Create a test file
    writeFileSync(join(testDir, "test.txt"), "content");

    const result = await executor.exec("ls test.txt", testDir);
    assert.strictEqual(result, "test.txt");
  });

  test("throws error for non-existent command", async () => {
    await assert.rejects(
      async () => executor.exec("nonexistent_command_xyz", testDir),
      /not found|command not found/i
    );
  });

  test("throws error for command that exits with non-zero code", async () => {
    await assert.rejects(async () => executor.exec("exit 1", testDir), Error);
  });

  test("throws error for invalid working directory", async () => {
    await assert.rejects(
      async () => executor.exec("echo test", "/nonexistent/directory/path/xyz"),
      Error
    );
  });

  test("handles command with multiple arguments", async () => {
    const result = await executor.exec("echo one two three", testDir);
    assert.strictEqual(result, "one two three");
  });

  test("handles command with pipes", async () => {
    const result = await executor.exec("echo hello | tr h H", testDir);
    assert.strictEqual(result, "Hello");
  });

  // Cleanup
  test("cleanup", () => {
    rmSync(testDir, { recursive: true, force: true });
  });
});

describe("defaultExecutor", () => {
  test("is an instance of ShellCommandExecutor", () => {
    assert.ok(defaultExecutor instanceof ShellCommandExecutor);
  });

  test("implements ICommandExecutor interface", () => {
    // TypeScript ensures this at compile time, but verify at runtime
    assert.strictEqual(typeof defaultExecutor.exec, "function");
  });

  test("runs commands successfully", async () => {
    const result = await defaultExecutor.exec("echo default", tmpdir());
    assert.strictEqual(result, "default");
  });
});

describe("ICommandExecutor interface", () => {
  test("can be implemented with custom executor", async () => {
    const mockExecutor: ICommandExecutor = {
      async exec(_command: string, _cwd: string): Promise<string> {
        return "mocked output";
      },
    };

    const result = await mockExecutor.exec("any command", "/any/path");
    assert.strictEqual(result, "mocked output");
  });

  test("allows tracking of executed commands", async () => {
    const commands: Array<{ command: string; cwd: string }> = [];

    const trackingExecutor: ICommandExecutor = {
      async exec(command: string, cwd: string): Promise<string> {
        commands.push({ command, cwd });
        return "tracked";
      },
    };

    await trackingExecutor.exec("git status", "/repo");
    await trackingExecutor.exec("git log", "/repo");

    assert.strictEqual(commands.length, 2);
    assert.strictEqual(commands[0].command, "git status");
    assert.strictEqual(commands[1].command, "git log");
  });
});
