import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { SecretsProcessor } from "../../../src/secrets/processor.js";
import type {
  ISecretsStrategy,
  GitHubSecret,
  GitHubPublicKey,
} from "../../../src/secrets/types.js";
import type { ISecretEncryptor } from "../../../src/secrets/encryption.js";
import type { IEnvResolver } from "../../../src/shared/env-resolver.js";
import type {
  GitHubRepoInfo,
  AzureDevOpsRepoInfo,
  RepoInfo,
} from "../../../src/repo/index.js";
import type { GhApiOptions } from "../../../src/shared/gh-api-utils.js";
import type { SecretConfig } from "../../../src/config/index.js";

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
  async upsert(
    _r: RepoInfo,
    name: string,
    encrypted: string,
    keyId: string
  ): Promise<void> {
    this.calls.push({ method: "upsert", args: [name, encrypted, keyId] });
  }
  async delete(_r: RepoInfo, name: string): Promise<void> {
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

function makeSecretsConfig(
  secrets: Record<string, SecretConfig>,
  deleteOrphaned = false
): Record<string, SecretConfig | boolean> & { deleteOrphaned?: boolean } {
  return { ...secrets, deleteOrphaned };
}

describe("SecretsProcessor", () => {
  test("upserts all configured secrets", async () => {
    const strategy = new MockSecretsStrategy();
    strategy.listResponse = [];
    const envResolver = new MockEnvResolver({ TOKEN_SOURCE: "secret-value" });
    const processor = new SecretsProcessor(
      strategy,
      new MockEncryptor(),
      envResolver
    );
    const result = await processor.process(
      makeSecretsConfig({ DEPLOY_TOKEN: { env: "TOKEN_SOURCE" } }),
      mockGitHubRepo,
      {}
    );
    assert.equal(result.success, true);
    assert.equal(result.created, 1);
    const upsertCalls = strategy.calls.filter((c) => c.method === "upsert");
    assert.equal(upsertCalls.length, 1);
  });

  test("detects existing secrets as updates", async () => {
    const strategy = new MockSecretsStrategy();
    strategy.listResponse = [
      { name: "DEPLOY_TOKEN", created_at: "", updated_at: "" },
    ];
    const envResolver = new MockEnvResolver({ TOKEN_SOURCE: "new-value" });
    const processor = new SecretsProcessor(
      strategy,
      new MockEncryptor(),
      envResolver
    );
    const result = await processor.process(
      makeSecretsConfig({ DEPLOY_TOKEN: { env: "TOKEN_SOURCE" } }),
      mockGitHubRepo,
      {}
    );
    assert.equal(result.success, true);
    assert.equal(result.updated, 1);
  });

  test("deletes orphaned secrets when deleteOrphaned is true", async () => {
    const strategy = new MockSecretsStrategy();
    strategy.listResponse = [
      { name: "OLD_SECRET", created_at: "", updated_at: "" },
    ];
    const processor = new SecretsProcessor(
      strategy,
      new MockEncryptor(),
      new MockEnvResolver({})
    );
    const result = await processor.process(
      makeSecretsConfig({}, true),
      mockGitHubRepo,
      {}
    );
    assert.equal(result.deleted, 1);
    const deleteCalls = strategy.calls.filter((c) => c.method === "delete");
    assert.equal(deleteCalls.length, 1);
  });

  test("dry run does not call upsert or delete", async () => {
    const strategy = new MockSecretsStrategy();
    strategy.listResponse = [];
    const processor = new SecretsProcessor(
      strategy,
      new MockEncryptor(),
      new MockEnvResolver({ SRC: "val" })
    );
    const result = await processor.process(
      makeSecretsConfig({ MY_SECRET: { env: "SRC" } }),
      mockGitHubRepo,
      { dryRun: true }
    );
    assert.equal(result.dryRun, true);
    const mutatingCalls = strategy.calls.filter((c) => c.method !== "list");
    assert.equal(mutatingCalls.length, 0);
  });

  test("fails fast when env vars are missing", async () => {
    const strategy = new MockSecretsStrategy();
    const processor = new SecretsProcessor(
      strategy,
      new MockEncryptor(),
      new MockEnvResolver({})
    );
    await assert.rejects(
      () =>
        processor.process(
          makeSecretsConfig({ SEC: { env: "MISSING_VAR" } }),
          mockGitHubRepo,
          {}
        ),
      /MISSING_VAR/
    );
  });

  test("skips non-GitHub repos", async () => {
    const strategy = new MockSecretsStrategy();
    const processor = new SecretsProcessor(
      strategy,
      new MockEncryptor(),
      new MockEnvResolver({})
    );
    const adoRepo: AzureDevOpsRepoInfo = {
      type: "azure-devops",
      owner: "org",
      repo: "repo",
      organization: "org",
      project: "proj",
      gitUrl: "https://dev.azure.com/org/proj/_git/repo",
    };
    const result = await processor.process(
      makeSecretsConfig({ SEC: { env: "VAR" } }),
      adoRepo,
      {}
    );
    assert.equal(result.skipped, true);
  });
});
