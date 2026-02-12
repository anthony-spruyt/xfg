import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ManifestStrategy } from "../../../src/sync/manifest-strategy.js";
import type { SessionContext } from "../../../src/sync/index.js";
import { MANIFEST_FILENAME } from "../../../src/sync/manifest.js";
import type { RepoConfig } from "../../../src/config/index.js";
import type { GitHubRepoInfo } from "../../../src/shared/repo-detector.js";
import {
  createMockAuthenticatedGitOps,
  createMockLogger,
} from "../../mocks/index.js";

describe("ManifestStrategy", () => {
  const testDir = join(tmpdir(), `manifest-strategy-test-${Date.now()}`);
  let workDir: string;

  const mockRepoConfig: RepoConfig = {
    git: "git@github.com:test/repo.git",
    files: [],
  };

  const mockRepoInfo: GitHubRepoInfo = {
    type: "github",
    gitUrl: "git@github.com:test/repo.git",
    owner: "test",
    repo: "repo",
    host: "github.com",
  };

  beforeEach(() => {
    workDir = join(testDir, `workspace-${Date.now()}`);
    mkdirSync(workDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("returns null when manifest unchanged", async () => {
    // Create existing manifest with same rulesets (version 3 format)
    const existingManifest = {
      version: 3,
      configs: {
        "test-config": {
          rulesets: ["ruleset-a"],
        },
      },
    };
    writeFileSync(
      join(workDir, MANIFEST_FILENAME),
      JSON.stringify(existingManifest, null, 2)
    );

    const { mock: mockLogger } = createMockLogger();
    const strategy = new ManifestStrategy(
      { rulesets: ["ruleset-a"] },
      mockLogger
    );

    const { mock: mockGitOps } = createMockAuthenticatedGitOps({
      hasChanges: false,
    });
    const session: SessionContext = {
      gitOps: mockGitOps,
      baseBranch: "main",
      cleanup: () => {},
    };

    const result = await strategy.execute(
      mockRepoConfig,
      mockRepoInfo,
      session,
      { branchName: "test", workDir, configId: "test-config" }
    );

    assert.equal(result, null);
  });

  test("returns WorkResult when manifest changes", async () => {
    // No existing manifest
    const { mock: mockLogger } = createMockLogger();
    const strategy = new ManifestStrategy(
      { rulesets: ["ruleset-a"] },
      mockLogger
    );

    const { mock: mockGitOps } = createMockAuthenticatedGitOps({
      hasChanges: true,
    });
    const session: SessionContext = {
      gitOps: mockGitOps,
      baseBranch: "main",
      cleanup: () => {},
    };

    const result = await strategy.execute(
      mockRepoConfig,
      mockRepoInfo,
      session,
      { branchName: "test", workDir, configId: "test-config" }
    );

    assert.ok(result);
    assert.ok(result.fileChanges.has(MANIFEST_FILENAME));
    assert.equal(result.changedFiles.length, 1);
    assert.equal(
      result.commitMessage,
      "chore: update manifest with ruleset tracking"
    );
    assert.equal(result.fileChangeDetails.length, 1);
  });

  test("logs dry-run message when dryRun is true", async () => {
    const { mock: mockLogger, messages } = createMockLogger();
    const strategy = new ManifestStrategy(
      { rulesets: ["new-ruleset"] },
      mockLogger
    );

    const { mock: mockGitOps } = createMockAuthenticatedGitOps({
      hasChanges: true,
    });
    const session: SessionContext = {
      gitOps: mockGitOps,
      baseBranch: "main",
      cleanup: () => {},
    };

    await strategy.execute(mockRepoConfig, mockRepoInfo, session, {
      branchName: "test",
      workDir,
      configId: "test-config",
      dryRun: true,
    });

    assert.ok(
      messages.some((m) => m.includes("Would update")),
      `Expected dry-run message, got: ${messages.join(", ")}`
    );
  });
});
