import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GitOps, sanitizeBranchName } from "./git-ops.js";

const testDir = join(tmpdir(), "git-ops-test-" + Date.now());

describe("sanitizeBranchName", () => {
  test("removes file extension", () => {
    assert.equal(sanitizeBranchName("config.json"), "config");
  });

  test("converts to lowercase", () => {
    assert.equal(sanitizeBranchName("MyConfig.json"), "myconfig");
  });

  test("replaces spaces with dashes", () => {
    assert.equal(sanitizeBranchName("my config.json"), "my-config");
  });

  test("replaces special characters with dashes", () => {
    assert.equal(sanitizeBranchName("my@config!file.json"), "my-config-file");
  });

  test("collapses multiple dashes", () => {
    assert.equal(sanitizeBranchName("my---config.json"), "my-config");
  });

  test("removes leading dashes", () => {
    assert.equal(sanitizeBranchName("-config.json"), "config");
  });

  test("removes trailing dashes", () => {
    assert.equal(sanitizeBranchName("config-.json"), "config");
  });

  test("handles multiple extensions (keeps all but last)", () => {
    assert.equal(sanitizeBranchName("my.config.json"), "my-config");
  });

  test("handles .yaml extension", () => {
    assert.equal(sanitizeBranchName("settings.yaml"), "settings");
  });

  test("handles .yml extension", () => {
    assert.equal(sanitizeBranchName("settings.yml"), "settings");
  });

  test("preserves numbers", () => {
    assert.equal(sanitizeBranchName("config2.json"), "config2");
  });

  test("preserves existing dashes", () => {
    assert.equal(sanitizeBranchName("my-config.json"), "my-config");
  });

  test("handles complex filename", () => {
    assert.equal(
      sanitizeBranchName("My Complex_Config@v2.0.json"),
      "my-complex-config-v2-0",
    );
  });

  test("handles filename with only special chars", () => {
    assert.equal(sanitizeBranchName("@#$.json"), "");
  });

  test("handles empty extension", () => {
    assert.equal(sanitizeBranchName("config"), "config");
  });
});

describe("GitOps", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = join(testDir, `workspace-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("cleanWorkspace", () => {
    test("creates workspace directory if not exists", () => {
      const gitOps = new GitOps({ workDir });
      gitOps.cleanWorkspace();

      assert.ok(existsSync(workDir));
    });

    test("removes existing workspace and recreates", () => {
      mkdirSync(workDir, { recursive: true });
      writeFileSync(join(workDir, "existing-file.txt"), "content");

      const gitOps = new GitOps({ workDir });
      gitOps.cleanWorkspace();

      assert.ok(existsSync(workDir));
      assert.ok(!existsSync(join(workDir, "existing-file.txt")));
    });

    test("handles nested directories", () => {
      const nestedDir = join(workDir, "nested", "deep");
      mkdirSync(nestedDir, { recursive: true });
      writeFileSync(join(nestedDir, "file.txt"), "content");

      const gitOps = new GitOps({ workDir });
      gitOps.cleanWorkspace();

      assert.ok(existsSync(workDir));
      assert.ok(!existsSync(join(workDir, "nested")));
    });
  });

  describe("writeFile", () => {
    beforeEach(() => {
      mkdirSync(workDir, { recursive: true });
    });

    test("writes file with content and trailing newline", () => {
      const gitOps = new GitOps({ workDir });
      gitOps.writeFile("test.json", '{"key": "value"}');

      const content = readFileSync(join(workDir, "test.json"), "utf-8");
      assert.equal(content, '{"key": "value"}\n');
    });

    test("overwrites existing file", () => {
      writeFileSync(join(workDir, "test.json"), "old content");

      const gitOps = new GitOps({ workDir });
      gitOps.writeFile("test.json", "new content");

      const content = readFileSync(join(workDir, "test.json"), "utf-8");
      assert.equal(content, "new content\n");
    });

    test("does not write in dry-run mode", () => {
      const gitOps = new GitOps({ workDir, dryRun: true });
      gitOps.writeFile("test.json", "content");

      assert.ok(!existsSync(join(workDir, "test.json")));
    });
  });

  describe("wouldChange", () => {
    beforeEach(() => {
      mkdirSync(workDir, { recursive: true });
    });

    test("returns true when file does not exist", () => {
      const gitOps = new GitOps({ workDir });
      const result = gitOps.wouldChange("nonexistent.json", "content");

      assert.equal(result, true);
    });

    test("returns true when content differs", () => {
      writeFileSync(join(workDir, "test.json"), "old content\n");

      const gitOps = new GitOps({ workDir });
      const result = gitOps.wouldChange("test.json", "new content");

      assert.equal(result, true);
    });

    test("returns false when content is identical", () => {
      writeFileSync(join(workDir, "test.json"), "same content\n");

      const gitOps = new GitOps({ workDir });
      const result = gitOps.wouldChange("test.json", "same content");

      assert.equal(result, false);
    });

    test("accounts for trailing newline in comparison", () => {
      // File has content + newline
      writeFileSync(join(workDir, "test.json"), "content\n");

      const gitOps = new GitOps({ workDir });
      // wouldChange adds newline internally, so "content" should match "content\n"
      const result = gitOps.wouldChange("test.json", "content");

      assert.equal(result, false);
    });

    test("works in dry-run mode", () => {
      writeFileSync(join(workDir, "test.json"), "existing\n");

      const gitOps = new GitOps({ workDir, dryRun: true });
      const resultSame = gitOps.wouldChange("test.json", "existing");
      const resultDiff = gitOps.wouldChange("test.json", "different");

      assert.equal(resultSame, false);
      assert.equal(resultDiff, true);
    });
  });

  describe("dryRun mode", () => {
    beforeEach(() => {
      mkdirSync(workDir, { recursive: true });
    });

    test("dryRun defaults to false", () => {
      const gitOps = new GitOps({ workDir });
      // Write should work when dryRun is not specified
      gitOps.writeFile("test.json", "content");
      assert.ok(existsSync(join(workDir, "test.json")));
    });

    test("dryRun can be explicitly set to false", () => {
      const gitOps = new GitOps({ workDir, dryRun: false });
      gitOps.writeFile("test.json", "content");
      assert.ok(existsSync(join(workDir, "test.json")));
    });
  });
});
