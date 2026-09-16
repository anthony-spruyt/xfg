import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { AdoMigrationSource } from "../../../src/lifecycle/ado-migration-source.js";
import { createMockExecutor } from "../../mocks/index.js";
import type { AzureDevOpsRepoInfo } from "../../../src/repo/index.js";

describe("AdoMigrationSource", () => {
  const mockRepoInfo: AzureDevOpsRepoInfo = {
    type: "azure-devops",
    gitUrl: "https://dev.azure.com/myorg/myproject/_git/myrepo",
    owner: "myorg",
    repo: "myrepo",
    organization: "myorg",
    project: "myproject",
  };

  describe("cloneForMigration()", () => {
    test("clones with --mirror flag", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const source = new AdoMigrationSource(executor, 0, "/test");
      await source.cloneForMigration(mockRepoInfo, "/tmp/migration");

      assert.equal(calls.length, 1);
      assert.equal(calls[0].executable, "git");
      assert.ok(calls[0].args.includes("clone"));
      assert.ok(calls[0].args.includes("--mirror"));
      const ddIdx = calls[0].args.indexOf("--");
      assert.ok(
        ddIdx !== -1,
        "Expected -- separator to prevent argument injection"
      );
      assert.ok(
        ddIdx < calls[0].args.indexOf(mockRepoInfo.gitUrl),
        "-- must come before gitUrl"
      );
    });

    test("clones to specified directory", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const source = new AdoMigrationSource(executor, 0, "/test");
      await source.cloneForMigration(mockRepoInfo, "/tmp/migration");

      assert.ok(calls[0].args.includes("/tmp/migration"));
    });

    test("uses repo gitUrl", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const source = new AdoMigrationSource(executor, 0, "/test");
      await source.cloneForMigration(mockRepoInfo, "/tmp/migration");

      assert.ok(calls[0].args.includes(mockRepoInfo.gitUrl));
    });

    test("throws on clone failure", async () => {
      const { mock: executor } = createMockExecutor({
        responses: new Map([["git clone", new Error("Authentication failed")]]),
      });

      const source = new AdoMigrationSource(executor, 0, "/test");

      await assert.rejects(
        () => source.cloneForMigration(mockRepoInfo, "/tmp/migration"),
        /Authentication failed/
      );
    });

    test("uses injected cwd for command execution", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const source = new AdoMigrationSource(executor, 0, "/custom/work/dir");
      await source.cloneForMigration(mockRepoInfo, "/tmp/migration");

      assert.equal(calls[0].cwd, "/custom/work/dir");
    });

    test("rejects non-ADO repo", async () => {
      const { mock: executor } = createMockExecutor({
        defaultResponse: "",
      });

      const githubRepo = {
        type: "github" as const,
        gitUrl: "git@github.com:test/repo.git",
        owner: "test",
        repo: "repo",
        host: "github.com",
      };

      const source = new AdoMigrationSource(executor, 0, "/test");

      await assert.rejects(
        () => source.cloneForMigration(githubRepo, "/tmp/migration"),
        /requires Azure DevOps repo/
      );
    });
  });
});
