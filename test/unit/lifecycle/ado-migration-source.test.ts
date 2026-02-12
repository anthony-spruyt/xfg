import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { AdoMigrationSource } from "../../../src/lifecycle/ado-migration-source.js";
import { createMockExecutor } from "../../mocks/index.js";
import type { AzureDevOpsRepoInfo } from "../../../src/shared/repo-detector.js";

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

      const source = new AdoMigrationSource(executor, 0);
      await source.cloneForMigration(mockRepoInfo, "/tmp/migration");

      assert.equal(calls.length, 1);
      assert.ok(calls[0].command.includes("git clone --mirror"));
    });

    test("clones to specified directory", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const source = new AdoMigrationSource(executor, 0);
      await source.cloneForMigration(mockRepoInfo, "/tmp/migration");

      assert.ok(calls[0].command.includes("/tmp/migration"));
    });

    test("uses repo gitUrl", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const source = new AdoMigrationSource(executor, 0);
      await source.cloneForMigration(mockRepoInfo, "/tmp/migration");

      assert.ok(calls[0].command.includes(mockRepoInfo.gitUrl));
    });

    test("throws on clone failure", async () => {
      const { mock: executor } = createMockExecutor({
        responses: new Map([["git clone", new Error("Authentication failed")]]),
      });

      const source = new AdoMigrationSource(executor, 0);

      await assert.rejects(
        () => source.cloneForMigration(mockRepoInfo, "/tmp/migration"),
        /Authentication failed/
      );
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

      const source = new AdoMigrationSource(executor, 0);

      await assert.rejects(
        () => source.cloneForMigration(githubRepo, "/tmp/migration"),
        /requires Azure DevOps repo/
      );
    });
  });
});
