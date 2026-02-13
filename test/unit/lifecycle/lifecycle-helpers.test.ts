import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  toCreateRepoSettings,
  runLifecycleCheck,
} from "../../../src/lifecycle/lifecycle-helpers.js";
import type { IRepoLifecycleManager } from "../../../src/lifecycle/types.js";
import type { GitHubRepoInfo } from "../../../src/shared/repo-detector.js";
import type { RepoConfig } from "../../../src/config/types.js";

describe("lifecycle-helpers", () => {
  describe("toCreateRepoSettings()", () => {
    test("returns undefined when repo settings is undefined", () => {
      assert.equal(toCreateRepoSettings(undefined), undefined);
    });

    test("extracts relevant fields from GitHubRepoSettings", () => {
      const result = toCreateRepoSettings({
        visibility: "private",
        description: "Test repo",
        hasIssues: false,
        hasWiki: false,
        hasProjects: false, // should not be in output
        hasDiscussions: true, // should not be in output
      });

      assert.deepEqual(result, {
        visibility: "private",
        description: "Test repo",
        hasIssues: false,
        hasWiki: false,
      });
    });

    test("returns undefined for empty settings object", () => {
      const result = toCreateRepoSettings({});

      assert.equal(result, undefined);
    });

    test("returns settings with only defined fields", () => {
      const result = toCreateRepoSettings({ visibility: "private" });

      assert.deepEqual(result, {
        visibility: "private",
      });
    });
  });

  describe("runLifecycleCheck()", () => {
    const mockRepoInfo: GitHubRepoInfo = {
      type: "github",
      gitUrl: "git@github.com:test-org/test-repo.git",
      owner: "test-org",
      repo: "test-repo",
      host: "github.com",
    };

    test("returns lifecycle result and output lines", async () => {
      const mockManager: IRepoLifecycleManager = {
        async ensureRepo() {
          return { repoInfo: mockRepoInfo, action: "created" };
        },
      };

      const repoConfig: RepoConfig = {
        git: mockRepoInfo.gitUrl,
        files: [],
      };

      const result = await runLifecycleCheck(
        repoConfig,
        mockRepoInfo,
        0,
        { dryRun: false },
        mockManager
      );

      assert.equal(result.lifecycleResult.action, "created");
      assert.ok(result.outputLines.length > 0);
      assert.ok(result.outputLines[0].includes("CREATE"));
    });

    test("returns empty output for existed action", async () => {
      const mockManager: IRepoLifecycleManager = {
        async ensureRepo() {
          return { repoInfo: mockRepoInfo, action: "existed" };
        },
      };

      const repoConfig: RepoConfig = {
        git: mockRepoInfo.gitUrl,
        files: [],
      };

      const result = await runLifecycleCheck(
        repoConfig,
        mockRepoInfo,
        0,
        { dryRun: false },
        mockManager
      );

      assert.equal(result.lifecycleResult.action, "existed");
      assert.equal(result.outputLines.length, 0);
    });

    test("passes githubHosts through to lifecycle options", async () => {
      let receivedOptions: unknown;
      const mockManager: IRepoLifecycleManager = {
        async ensureRepo(_repoConfig, _repoInfo, options) {
          receivedOptions = options;
          return { repoInfo: mockRepoInfo, action: "existed" };
        },
      };

      const repoConfig: RepoConfig = {
        git: mockRepoInfo.gitUrl,
        files: [],
      };

      await runLifecycleCheck(
        repoConfig,
        mockRepoInfo,
        0,
        { dryRun: false, githubHosts: ["ghe.example.com"] },
        mockManager
      );

      assert.deepEqual(
        (receivedOptions as { githubHosts: string[] }).githubHosts,
        ["ghe.example.com"]
      );
    });

    test("passes repo settings to lifecycle manager", async () => {
      let receivedSettings: unknown;
      const mockManager: IRepoLifecycleManager = {
        async ensureRepo(_repoConfig, _repoInfo, _options, settings) {
          receivedSettings = settings;
          return { repoInfo: mockRepoInfo, action: "existed" };
        },
      };

      const repoConfig: RepoConfig = {
        git: mockRepoInfo.gitUrl,
        files: [],
      };

      await runLifecycleCheck(
        repoConfig,
        mockRepoInfo,
        0,
        { dryRun: false },
        mockManager,
        { visibility: "private", description: "test" }
      );

      assert.deepEqual(receivedSettings, {
        visibility: "private",
        description: "test",
      });
    });
  });
});
