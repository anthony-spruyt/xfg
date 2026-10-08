import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { SecretsProcessor } from "../../../../src/settings/secrets/processor.js";
import { formatSecretsPlan } from "../../../../src/settings/secrets/formatter.js";
import type {
  ISecretsStrategy,
  GitHubSecret,
  GitHubPublicKey,
} from "../../../../src/settings/secrets/types.js";
import type {
  GitHubEnvironment,
  IEnvironmentSecretsStrategy,
} from "../../../../src/settings/environments/types.js";
import type { ISecretEncryptor } from "../../../../src/settings/secrets/encryption.js";
import type { IEnvResolver } from "../../../../src/shared/env-resolver.js";
import type {
  GitHubRepoInfo,
  IRepoMetadataProvider,
  RepoInfo,
} from "../../../../src/repo/index.js";
import type {
  EnvironmentConfig,
  RepoConfig,
  RepoVisibility,
  SecretConfig,
} from "../../../../src/config/index.js";

const strip = (s: string) =>
  s.replace(new RegExp(String.fromCharCode(0x1b) + "\\[[0-9;]*m", "g"), "");

class MockRepoSecrets implements ISecretsStrategy {
  calls: { method: string; args: unknown[] }[] = [];
  async list(): Promise<GitHubSecret[]> {
    this.calls.push({ method: "list", args: [] });
    return [];
  }
  async getPublicKey(): Promise<GitHubPublicKey> {
    this.calls.push({ method: "getPublicKey", args: [] });
    return { key_id: "repo-key", key: "repo-pub" };
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

class MockEnvSecrets implements IEnvironmentSecretsStrategy {
  calls: { method: string; args: unknown[] }[] = [];
  environments: GitHubEnvironment[] = [];
  secrets = new Map<string, GitHubSecret[]>();

  async list(): Promise<GitHubEnvironment[]> {
    return this.environments;
  }
  async listSecrets(_r: RepoInfo, env: string): Promise<GitHubSecret[]> {
    this.calls.push({ method: "listSecrets", args: [env] });
    return this.secrets.get(env) ?? [];
  }
  async getSecretsPublicKey(
    _r: RepoInfo,
    env: string
  ): Promise<GitHubPublicKey> {
    this.calls.push({ method: "getSecretsPublicKey", args: [env] });
    return { key_id: `${env}-key`, key: `${env}-pub` };
  }
  async upsertSecret(
    _r: RepoInfo,
    env: string,
    name: string,
    encrypted: string,
    keyId: string
  ): Promise<void> {
    this.calls.push({
      method: "upsertSecret",
      args: [env, name, encrypted, keyId],
    });
  }
}

class MockEncryptor implements ISecretEncryptor {
  async encrypt(value: string, key: string): Promise<string> {
    return `${key}:${value.length}`;
  }
}

class MockEnvResolver implements IEnvResolver {
  constructor(private readonly values: Record<string, string>) {}
  resolve(name: string): string {
    return this.values[name];
  }
  resolveAll(entries: { name: string; envVar: string }[]): Map<string, string> {
    const missing = entries.filter((e) => !(e.envVar in this.values));
    if (missing.length > 0) {
      throw new Error(
        `Missing environment variables: ${missing.map((e) => e.envVar).join(", ")}`
      );
    }
    return new Map(entries.map((e) => [e.name, this.values[e.envVar]]));
  }
}

function metadata(
  visibility: RepoVisibility = "public"
): IRepoMetadataProvider & { called: number } {
  return {
    called: 0,
    async getMetadata() {
      this.called++;
      return { visibility, ownerType: "User", hasGHAS: false };
    },
  };
}

const repo: GitHubRepoInfo = {
  type: "github",
  owner: "me",
  repo: "r",
  host: "github.com",
  gitUrl: "https://github.com/me/r.git",
};

function config(
  environments: Record<string, EnvironmentConfig>,
  secrets?: Record<string, SecretConfig>
): RepoConfig {
  return {
    git: repo.gitUrl,
    files: [],
    settings: { environments, ...(secrets ? { secrets } : {}) },
  };
}

function setup(
  opts: {
    environments?: GitHubEnvironment[];
    visibility?: RepoVisibility;
    values?: Record<string, string>;
  } = {}
) {
  const repoSecrets = new MockRepoSecrets();
  const envSecrets = new MockEnvSecrets();
  envSecrets.environments = opts.environments ?? [
    { name: "release", deployment_branch_policy: null },
  ];
  const meta = metadata(opts.visibility);
  const processor = new SecretsProcessor(
    repoSecrets,
    new MockEncryptor(),
    new MockEnvResolver(opts.values ?? { SRC: "abc", REPO_SRC: "xyz" }),
    undefined,
    { strategy: envSecrets, metadataProvider: meta }
  );
  return { repoSecrets, envSecrets, meta, processor };
}

describe("formatSecretsPlan - environment secrets", () => {
  test("tags environment secrets with their environment", () => {
    const result = formatSecretsPlan(
      [
        { action: "create", name: "A", environment: "release" },
        { action: "update", name: "B", environment: "release" },
      ],
      true
    );
    assert.deepEqual(result.lines.map(strip), [
      '    + secret "A" (environment "release")',
      '    ~ secret "B" (environment "release", update, value write-only)',
      "  Plan: 2 secrets (1 to create, 1 to update)",
    ]);
    assert.deepEqual(result.entries, [
      { name: "A", action: "create", environment: "release" },
      { name: "B", action: "update", environment: "release" },
    ]);
  });
});

describe("SecretsProcessor - environment secrets", () => {
  test("writes an environment secret with the environment's key", async () => {
    const { repoSecrets, envSecrets, processor } = setup();
    const result = await processor.process(
      config({ release: { secrets: { KEY: { env: "SRC" } } } }),
      repo,
      {}
    );
    assert.equal(result.success, true, result.message);
    assert.deepEqual(repoSecrets.calls, []);
    assert.deepEqual(envSecrets.calls, [
      { method: "listSecrets", args: ["release"] },
      { method: "getSecretsPublicKey", args: ["release"] },
      {
        method: "upsertSecret",
        args: ["release", "KEY", "release-pub:3", "release-key"],
      },
    ]);
    assert.equal(result.changes?.create, 1);
  });

  test("reports existing environment secrets as updates", async () => {
    const { envSecrets, processor } = setup();
    envSecrets.secrets.set("release", [
      { name: "KEY", created_at: "", updated_at: "" },
    ]);
    const result = await processor.process(
      config({ release: { secrets: { KEY: { env: "SRC" } } } }),
      repo,
      { dryRun: true }
    );
    assert.equal(result.changes?.update, 1);
    assert.deepEqual(result.planOutput?.entries, [
      { name: "KEY", action: "update", environment: "release" },
    ]);
    assert.ok(!envSecrets.calls.some((c) => c.method === "upsertSecret"));
  });

  test("uses GitHub's spelling of the environment name", async () => {
    const { envSecrets, processor } = setup({
      environments: [{ name: "Release", deployment_branch_policy: null }],
    });
    await processor.process(
      config({ release: { secrets: { KEY: { env: "SRC" } } } }),
      repo,
      {}
    );
    assert.deepEqual(envSecrets.calls[0], {
      method: "listSecrets",
      args: ["Release"],
    });
  });

  test("writes repo and environment secrets side by side", async () => {
    const { repoSecrets, envSecrets, processor } = setup();
    const result = await processor.process(
      config(
        { release: { secrets: { KEY: { env: "SRC" } } } },
        { KEY: { env: "REPO_SRC" } }
      ),
      repo,
      {}
    );
    assert.equal(result.changes?.create, 2);
    assert.deepEqual(
      repoSecrets.calls.find((c) => c.method === "upsert")?.args,
      ["KEY", "repo-pub:3", "repo-key"]
    );
    assert.ok(envSecrets.calls.some((c) => c.method === "upsertSecret"));
  });

  test("dry run plans secrets for an environment that does not exist yet", async () => {
    const { envSecrets, meta, processor } = setup({ environments: [] });
    const result = await processor.process(
      config({ release: { secrets: { KEY: { env: "SRC" } } } }),
      repo,
      { dryRun: true }
    );
    assert.equal(result.success, true);
    assert.equal(result.changes?.create, 1);
    assert.deepEqual(envSecrets.calls, []);
    assert.equal(meta.called, 0);
  });

  test("fails before writing when the environment is missing on a public repo", async () => {
    const { repoSecrets, envSecrets, processor } = setup({ environments: [] });
    const result = await processor.process(
      config(
        { release: { secrets: { KEY: { env: "SRC" } } } },
        { OTHER: { env: "REPO_SRC" } }
      ),
      repo,
      {}
    );
    assert.equal(result.success, false);
    assert.match(
      result.message,
      /environment "release" does not exist\. Run 'xfg sync' first to create it\./
    );
    assert.ok(!repoSecrets.calls.some((c) => c.method === "upsert"));
    assert.deepEqual(envSecrets.calls, []);
  });

  test("skips a missing environment's secrets on a private repo with a warning", async () => {
    const { repoSecrets, envSecrets, processor } = setup({
      environments: [],
      visibility: "private",
    });
    const result = await processor.process(
      config(
        { release: { secrets: { KEY: { env: "SRC" } } } },
        { OTHER: { env: "REPO_SRC" } }
      ),
      repo,
      {}
    );
    assert.equal(result.success, true, result.message);
    assert.equal(result.changes?.create, 1);
    assert.ok(repoSecrets.calls.some((c) => c.method === "upsert"));
    assert.deepEqual(envSecrets.calls, []);
    assert.deepEqual(result.warnings, [
      `me/r: environment "release" does not exist - its secrets were skipped (environments on private repos need a paid GitHub plan; on a paid plan, run 'xfg sync' first)`,
    ]);
  });

  test("fails before writing when an environment secret's source is unset", async () => {
    const { repoSecrets, envSecrets, processor } = setup({
      values: { REPO_SRC: "xyz" },
    });
    const result = await processor.process(
      config(
        { release: { secrets: { KEY: { env: "SRC" } } } },
        { OTHER: { env: "REPO_SRC" } }
      ),
      repo,
      {}
    );
    assert.equal(result.success, false);
    assert.match(result.message, /Missing environment variables: SRC/);
    assert.ok(!repoSecrets.calls.some((c) => c.method === "upsert"));
    assert.ok(!envSecrets.calls.some((c) => c.method === "upsertSecret"));
  });

  test("ignores environments without secrets", async () => {
    const { envSecrets, processor } = setup();
    const result = await processor.process(
      config({ release: {} }),
      repo,
      {}
    );
    assert.equal(result.skipped, true);
    assert.equal(result.noSecretsConfigured, true);
    assert.deepEqual(envSecrets.calls, []);
  });
});
