import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { RepoLifecycleFactory } from "../../../src/lifecycle/repo-lifecycle-factory.js";
import { GitHubLifecycleProvider } from "../../../src/lifecycle/github-lifecycle-provider.js";
import { AdoMigrationSource } from "../../../src/lifecycle/ado-migration-source.js";

describe("RepoLifecycleFactory", () => {
  describe("getProvider()", () => {
    test("returns GitHubLifecycleProvider for github", () => {
      const factory = new RepoLifecycleFactory();
      const provider = factory.getProvider("github");

      assert.ok(provider instanceof GitHubLifecycleProvider);
      assert.equal(provider.platform, "github");
    });

    test("throws for unsupported platform", () => {
      const factory = new RepoLifecycleFactory();

      assert.throws(
        () => factory.getProvider("azure-devops"),
        /not supported as target/
      );
    });

    test("caches provider instances", () => {
      const factory = new RepoLifecycleFactory();
      const provider1 = factory.getProvider("github");
      const provider2 = factory.getProvider("github");

      assert.strictEqual(provider1, provider2);
    });
  });

  describe("getMigrationSource()", () => {
    test("returns AdoMigrationSource for azure-devops", () => {
      const factory = new RepoLifecycleFactory();
      const source = factory.getMigrationSource("azure-devops");

      assert.ok(source instanceof AdoMigrationSource);
      assert.equal(source.platform, "azure-devops");
    });

    test("throws for unsupported platform", () => {
      const factory = new RepoLifecycleFactory();

      assert.throws(
        () => factory.getMigrationSource("github"),
        /not supported as migration source/
      );
    });

    test("caches source instances", () => {
      const factory = new RepoLifecycleFactory();
      const source1 = factory.getMigrationSource("azure-devops");
      const source2 = factory.getMigrationSource("azure-devops");

      assert.strictEqual(source1, source2);
    });
  });
});
