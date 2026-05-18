import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { SecretsProcessor } from "../../../src/settings/secrets/processor.js";
import type {
  ISecretsStrategy,
  UpsertSecretParams,
  GitHubSecret,
  GitHubPublicKey,
} from "../../../src/settings/secrets/types.js";
import type { ISecretEncryptor } from "../../../src/settings/secrets/encryption.js";
import type { IEnvResolver } from "../../../src/shared/env-resolver.js";
import type {
  GitHubRepoInfo,
  AzureDevOpsRepoInfo,
  RepoInfo,
} from "../../../src/repo/index.js";
import type { GhApiOptions } from "../../../src/shared/gh-api-utils.js";
import type {
  SecretConfig,
  SecretsConfig,
  RepoConfig,
} from "../../../src/config/index.js";

class MockSecretsStrategy implements ISecretsStrategy {
  calls: { method: string; args: unknown[] }[] = [];
  listResponse: GitHubSecret[] = [];
  publicKey: GitHubPublicKey = { key_id: "key-1", key: "pubkey==" };

  async list(_r: RepoInfo, _o?: GhApiOptions): Promise<GitHubSecret[]> {
    this.calls.push({ method: "list", args: [] });
    return this.listResponse;
  }
  async getPublicKey(
    _r: RepoInfo,
    _o?: GhApiOptions
  ): Promise<GitHubPublicKey> {
    this.calls.push({ method: "getPublicKey", args: [] });
    return this.publicKey;
  }
  async upsert(params: UpsertSecretParams): Promise<void> {
    const { name, encryptedValue, keyId, options } = params;
    this.calls.push({
      method: "upsert",
      args: [name, encryptedValue, keyId, options],
    });
  }
  async delete(
    _r: RepoInfo,
    name: string,
    _options?: GhApiOptions
  ): Promise<void> {
    this.calls.push({ method: "delete", args: [name] });
  }
}

class MockEncryptor implements ISecretEncryptor {
  async encrypt(value: string, _key: string): Promise<string> {
    return Buffer.from(`encrypted:${value}`).toString("base64");
  }
}

class MockEnvResolver implements IEnvResolver {
  values: Map<string, string>;
  constructor(values: Record<string, string>) {
    this.values = new Map(Object.entries(values));
  }
  resolve(name: string): string {
    const v = this.values.get(name);
    if (!v) throw new Error(`Missing env var: ${name}`);
    return v;
  }
  resolveAll(entries: { name: string; envVar: string }[]): Map<string, string> {
    const missing: string[] = [];
    const result = new Map<string, string>();
    for (const { name, envVar } of entries) {
      const v = this.values.get(envVar);
      if (!v) {
        missing.push(envVar);
      } else {
        result.set(name, v);
      }
    }
    if (missing.length > 0) {
      throw new Error(`Missing environment variables: ${missing.join(", ")}`);
    }
    return result;
  }
}

const mockGitHubRepo: GitHubRepoInfo = {
  type: "github",
  owner: "test-org",
  repo: "test-repo",
  host: "github.com",
  gitUrl: "https://github.com/test-org/test-repo.git",
};

const stubRepoConfig: RepoConfig = {
  git: "https://github.com/test-org/test-repo.git",
  files: [],
};

function makeSecretsConfig(
  secrets: Record<string, SecretConfig>,
  deleteOrphaned = false
): SecretsConfig {
  return { ...secrets, deleteOrphaned };
}

describe("SecretsProcessor", () => {
  test("upserts all configured secrets", async () => {
    const strategy = new MockSecretsStrategy();
    strategy.listResponse = [];
    const envResolver = new MockEnvResolver({ TOKEN_SOURCE: "secret-value" });
    const secretsConfig = makeSecretsConfig({
      DEPLOY_TOKEN: { env: "TOKEN_SOURCE" },
    });
    const processor = new SecretsProcessor(
      strategy,
      new MockEncryptor(),
      envResolver,
      secretsConfig
    );
    const result = await processor.process(stubRepoConfig, mockGitHubRepo, {});
    assert.equal(result.success, true);
    assert.equal(result.changes?.create, 1);
    const upsertCalls = strategy.calls.filter((c) => c.method === "upsert");
    assert.equal(upsertCalls.length, 1);
    assert.equal(upsertCalls[0].args[0], "DEPLOY_TOKEN");
    assert.equal(
      upsertCalls[0].args[1],
      Buffer.from("encrypted:secret-value").toString("base64")
    );
    assert.equal(upsertCalls[0].args[2], "key-1");
    assert.deepEqual(upsertCalls[0].args[3], {
      token: undefined,
      host: "github.com",
    });
  });

  test("detects existing secrets as updates", async () => {
    const strategy = new MockSecretsStrategy();
    strategy.listResponse = [
      { name: "DEPLOY_TOKEN", created_at: "", updated_at: "" },
    ];
    const envResolver = new MockEnvResolver({ TOKEN_SOURCE: "new-value" });
    const secretsConfig = makeSecretsConfig({
      DEPLOY_TOKEN: { env: "TOKEN_SOURCE" },
    });
    const processor = new SecretsProcessor(
      strategy,
      new MockEncryptor(),
      envResolver,
      secretsConfig
    );
    const result = await processor.process(stubRepoConfig, mockGitHubRepo, {});
    assert.equal(result.success, true);
    assert.equal(result.changes?.update, 1);
    assert.equal(result.changes?.create, 0);
    const upsertCalls = strategy.calls.filter((c) => c.method === "upsert");
    assert.equal(upsertCalls[0].args[0], "DEPLOY_TOKEN");
    assert.equal(upsertCalls[0].args[2], "key-1");
  });

  test("deletes orphaned secrets when deleteOrphaned is true", async () => {
    const strategy = new MockSecretsStrategy();
    strategy.listResponse = [
      { name: "OLD_SECRET", created_at: "", updated_at: "" },
    ];
    const secretsConfig = makeSecretsConfig({}, true);
    const processor = new SecretsProcessor(
      strategy,
      new MockEncryptor(),
      new MockEnvResolver({}),
      secretsConfig
    );
    const result = await processor.process(stubRepoConfig, mockGitHubRepo, {});
    assert.equal(result.changes?.delete, 1);
    const deleteCalls = strategy.calls.filter((c) => c.method === "delete");
    assert.equal(deleteCalls.length, 1);
    assert.equal(deleteCalls[0].args[0], "OLD_SECRET");
  });

  test("noDelete suppresses orphan deletion even with deleteOrphaned true", async () => {
    const strategy = new MockSecretsStrategy();
    strategy.listResponse = [
      { name: "OLD_SECRET", created_at: "", updated_at: "" },
    ];
    const secretsConfig = makeSecretsConfig({}, true);
    const processor = new SecretsProcessor(
      strategy,
      new MockEncryptor(),
      new MockEnvResolver({}),
      secretsConfig
    );
    const result = await processor.process(stubRepoConfig, mockGitHubRepo, {
      noDelete: true,
    });
    assert.equal(result.changes?.delete, 0);
    const deleteCalls = strategy.calls.filter((c) => c.method === "delete");
    assert.equal(deleteCalls.length, 0);
  });

  test("dry run does not call upsert or delete", async () => {
    const strategy = new MockSecretsStrategy();
    strategy.listResponse = [];
    const secretsConfig = makeSecretsConfig({
      MY_SECRET: { env: "SRC" },
    });
    const processor = new SecretsProcessor(
      strategy,
      new MockEncryptor(),
      new MockEnvResolver({}),
      secretsConfig
    );
    const result = await processor.process(stubRepoConfig, mockGitHubRepo, {
      dryRun: true,
    });
    assert.equal(result.dryRun, true);
    const mutatingCalls = strategy.calls.filter((c) => c.method !== "list");
    assert.equal(mutatingCalls.length, 0);
  });

  test("dry run counts existing secrets as updates", async () => {
    const strategy = new MockSecretsStrategy();
    strategy.listResponse = [
      { name: "EXISTING", created_at: "", updated_at: "" },
    ];
    const secretsConfig = makeSecretsConfig({
      EXISTING: { env: "SRC" },
      NEW_ONE: { env: "SRC2" },
    });
    const processor = new SecretsProcessor(
      strategy,
      new MockEncryptor(),
      new MockEnvResolver({}),
      secretsConfig
    );
    const result = await processor.process(stubRepoConfig, mockGitHubRepo, {
      dryRun: true,
    });
    assert.equal(result.dryRun, true);
    assert.equal(result.changes?.update, 1);
    assert.equal(result.changes?.create, 1);
  });

  test("dry run counts orphans as deleted when deleteOrphaned is true", async () => {
    const strategy = new MockSecretsStrategy();
    strategy.listResponse = [
      { name: "ORPHAN", created_at: "", updated_at: "" },
    ];
    const secretsConfig = makeSecretsConfig({}, true);
    const processor = new SecretsProcessor(
      strategy,
      new MockEncryptor(),
      new MockEnvResolver({}),
      secretsConfig
    );
    const result = await processor.process(stubRepoConfig, mockGitHubRepo, {
      dryRun: true,
    });
    assert.equal(result.dryRun, true);
    assert.equal(result.changes?.delete, 1);
    const mutatingCalls = strategy.calls.filter((c) => c.method !== "list");
    assert.equal(mutatingCalls.length, 0);
  });

  test("fails fast when env vars are missing", async () => {
    const strategy = new MockSecretsStrategy();
    const secretsConfig = makeSecretsConfig({ SEC: { env: "MISSING_VAR" } });
    const processor = new SecretsProcessor(
      strategy,
      new MockEncryptor(),
      new MockEnvResolver({}),
      secretsConfig
    );
    // Error is caught by withGitHubGuards and returned as a failed result
    const result = await processor.process(stubRepoConfig, mockGitHubRepo, {});
    assert.equal(result.success, false);
    assert.ok(result.message.includes("MISSING_VAR"));
    const upsertCalls = strategy.calls.filter((c) => c.method === "upsert");
    assert.equal(upsertCalls.length, 0);
  });

  test("rejects empty env var value", async () => {
    const strategy = new MockSecretsStrategy();
    strategy.listResponse = [];
    const envResolver = new MockEnvResolver({ TOKEN_SOURCE: "" });
    const secretsConfig = makeSecretsConfig({
      DEPLOY_TOKEN: { env: "TOKEN_SOURCE" },
    });
    const processor = new SecretsProcessor(
      strategy,
      new MockEncryptor(),
      envResolver,
      secretsConfig
    );
    // Error is caught by withGitHubGuards and returned as a failed result
    const result = await processor.process(stubRepoConfig, mockGitHubRepo, {});
    assert.equal(result.success, false);
    assert.ok(result.message.includes("TOKEN_SOURCE"));
    const upsertCalls = strategy.calls.filter((c) => c.method === "upsert");
    assert.equal(upsertCalls.length, 0);
  });

  test("matches existing secret case-insensitively against API response", async () => {
    const strategy = new MockSecretsStrategy();
    strategy.listResponse = [
      { name: "my_secret", created_at: "", updated_at: "" },
    ];
    const envResolver = new MockEnvResolver({ SRC: "val1" });
    const secretsConfig = makeSecretsConfig({
      MY_SECRET: { env: "SRC" },
    });
    const processor = new SecretsProcessor(
      strategy,
      new MockEncryptor(),
      envResolver,
      secretsConfig
    );
    const result = await processor.process(stubRepoConfig, mockGitHubRepo, {});
    assert.equal(result.changes?.update, 1);
    assert.equal(result.changes?.create, 0);
    const upsertCalls = strategy.calls.filter((c) => c.method === "upsert");
    assert.equal(upsertCalls[0].args[0], "MY_SECRET");
  });

  test("deleteOrphaned with no secrets defined still deletes orphans", async () => {
    const strategy = new MockSecretsStrategy();
    strategy.listResponse = [
      { name: "ORPHAN_A", created_at: "", updated_at: "" },
      { name: "ORPHAN_B", created_at: "", updated_at: "" },
    ];
    const secretsConfig = makeSecretsConfig({}, true);
    const processor = new SecretsProcessor(
      strategy,
      new MockEncryptor(),
      new MockEnvResolver({}),
      secretsConfig
    );
    const result = await processor.process(stubRepoConfig, mockGitHubRepo, {});
    assert.equal(result.success, true);
    assert.equal(result.changes?.delete, 2);
    assert.equal(result.changes?.create, 0);
    assert.equal(result.changes?.update, 0);
    const deleteCalls = strategy.calls.filter((c) => c.method === "delete");
    assert.equal(deleteCalls.length, 2);
    const pubKeyCalls = strategy.calls.filter(
      (c) => c.method === "getPublicKey"
    );
    assert.equal(pubKeyCalls.length, 0);
  });

  test("handles mixed create, update, and delete in one call", async () => {
    const strategy = new MockSecretsStrategy();
    strategy.listResponse = [
      { name: "EXISTING", created_at: "", updated_at: "" },
      { name: "ORPHAN", created_at: "", updated_at: "" },
    ];
    const envResolver = new MockEnvResolver({
      SRC_EXISTING: "updated-val",
      SRC_NEW: "new-val",
    });
    const secretsConfig = makeSecretsConfig(
      {
        EXISTING: { env: "SRC_EXISTING" },
        BRAND_NEW: { env: "SRC_NEW" },
      },
      true
    );
    const processor = new SecretsProcessor(
      strategy,
      new MockEncryptor(),
      envResolver,
      secretsConfig
    );
    const result = await processor.process(stubRepoConfig, mockGitHubRepo, {});
    assert.equal(result.success, true);
    assert.equal(result.changes?.create, 1);
    assert.equal(result.changes?.update, 1);
    assert.equal(result.changes?.delete, 1);
    const upsertCalls = strategy.calls.filter((c) => c.method === "upsert");
    assert.equal(upsertCalls.length, 2);
    const deleteCalls = strategy.calls.filter((c) => c.method === "delete");
    assert.equal(deleteCalls.length, 1);
    assert.equal(deleteCalls[0].args[0], "ORPHAN");
  });

  test("skips non-GitHub repos", async () => {
    const strategy = new MockSecretsStrategy();
    const secretsConfig = makeSecretsConfig({ SEC: { env: "VAR" } });
    const processor = new SecretsProcessor(
      strategy,
      new MockEncryptor(),
      new MockEnvResolver({}),
      secretsConfig
    );
    const adoRepo: AzureDevOpsRepoInfo = {
      type: "azure-devops",
      owner: "org",
      repo: "repo",
      organization: "org",
      project: "proj",
      gitUrl: "https://dev.azure.com/org/proj/_git/repo",
    };
    const result = await processor.process(stubRepoConfig, adoRepo, {});
    assert.equal(result.skipped, true);
  });
});
