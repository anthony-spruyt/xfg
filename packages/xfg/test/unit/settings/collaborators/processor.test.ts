import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { CollaboratorsProcessor } from "../../../../src/settings/collaborators/processor.js";
import type {
  ICollaboratorsStrategy,
  GitHubCollaborator,
  GitHubRepoInvitation,
} from "../../../../src/settings/collaborators/types.js";
import type {
  CollaboratorsConfig,
  RepoConfig,
} from "../../../../src/config/index.js";
import type {
  GitHubRepoInfo,
  IRepoMetadataProvider,
  RepoMetadata,
} from "../../../../src/repo/index.js";

class MockStrategy implements ICollaboratorsStrategy {
  calls: { method: string; args: unknown[] }[] = [];
  collaborators: GitHubCollaborator[] = [];
  invitations: GitHubRepoInvitation[] = [];

  async listCollaborators(): Promise<GitHubCollaborator[]> {
    return this.collaborators;
  }
  async listInvitations(): Promise<GitHubRepoInvitation[]> {
    return this.invitations;
  }
  async add(_r: unknown, username: string): Promise<void> {
    this.calls.push({ method: "add", args: [username] });
  }
  async remove(_r: unknown, username: string): Promise<void> {
    this.calls.push({ method: "remove", args: [username] });
  }
  async cancelInvitation(_r: unknown, id: number): Promise<void> {
    this.calls.push({ method: "cancelInvitation", args: [id] });
  }
}

function metadata(
  ownerType: RepoMetadata["ownerType"] = "User"
): IRepoMetadataProvider & { called: number } {
  return {
    called: 0,
    async getMetadata() {
      this.called++;
      return { visibility: "public", ownerType, hasGHAS: false };
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

function config(collaborators?: CollaboratorsConfig): RepoConfig {
  return {
    git: repo.gitUrl,
    files: [],
    settings: collaborators ? { collaborators } : {},
  };
}

describe("CollaboratorsProcessor", () => {
  test("invites missing users", async () => {
    const strategy = new MockStrategy();
    const processor = new CollaboratorsProcessor(strategy, metadata());

    const result = await processor.process(
      config({ users: ["bot"] }),
      repo,
      {}
    );

    assert.equal(result.success, true);
    assert.deepEqual(strategy.calls, [{ method: "add", args: ["bot"] }]);
    assert.equal(result.changes?.create, 1);
  });

  test("dry run makes no calls", async () => {
    const strategy = new MockStrategy();
    const processor = new CollaboratorsProcessor(strategy, metadata());

    const result = await processor.process(config({ users: ["bot"] }), repo, {
      dryRun: true,
    });

    assert.equal(result.dryRun, true);
    assert.deepEqual(strategy.calls, []);
    assert.equal(result.planOutput?.creates, 1);
  });

  test("pending invite is not re-sent", async () => {
    const strategy = new MockStrategy();
    strategy.invitations = [{ id: 1, invitee: { login: "bot" } }];
    const processor = new CollaboratorsProcessor(strategy, metadata());

    const result = await processor.process(
      config({ users: ["bot"] }),
      repo,
      {}
    );

    assert.deepEqual(strategy.calls, []);
    assert.equal(result.message, "No changes needed");
  });

  test("expired invite is cancelled before inviting again", async () => {
    const strategy = new MockStrategy();
    strategy.invitations = [
      { id: 4, invitee: { login: "bot" }, expired: true },
    ];
    const processor = new CollaboratorsProcessor(strategy, metadata());

    await processor.process(config({ users: ["bot"] }), repo, {});

    assert.deepEqual(strategy.calls, [
      { method: "cancelInvitation", args: [4] },
      { method: "add", args: ["bot"] },
    ]);
  });

  test("deleteOrphaned removes everyone not in config except the owner", async () => {
    const strategy = new MockStrategy();
    strategy.collaborators = [
      { login: "me" },
      { login: "bot" },
      { login: "old" },
    ];
    strategy.invitations = [{ id: 9, invitee: { login: "late" } }];
    const processor = new CollaboratorsProcessor(strategy, metadata());

    await processor.process(
      config({ users: ["bot"], deleteOrphaned: true }),
      repo,
      {}
    );

    assert.deepEqual(
      strategy.calls.sort((a, b) => a.method.localeCompare(b.method)),
      [
        { method: "cancelInvitation", args: [9] },
        { method: "remove", args: ["old"] },
      ]
    );
  });

  test("without deleteOrphaned nobody is removed", async () => {
    const strategy = new MockStrategy();
    strategy.collaborators = [{ login: "old" }];
    strategy.invitations = [{ id: 9, invitee: { login: "late" } }];
    const processor = new CollaboratorsProcessor(strategy, metadata());

    await processor.process(config({ users: ["bot"] }), repo, {});

    assert.deepEqual(strategy.calls, [{ method: "add", args: ["bot"] }]);
  });

  test("deleteOrphaned with no users still runs", async () => {
    const strategy = new MockStrategy();
    const processor = new CollaboratorsProcessor(strategy, metadata());

    const result = await processor.process(
      config({ deleteOrphaned: true }),
      repo,
      {}
    );

    assert.equal(result.skipped, undefined);
    assert.equal(result.message, "No changes needed");
  });

  test("--no-delete suppresses removals", async () => {
    const strategy = new MockStrategy();
    strategy.collaborators = [{ login: "old" }];
    const processor = new CollaboratorsProcessor(strategy, metadata());

    await processor.process(config({ users: [], deleteOrphaned: true }), repo, {
      noDelete: true,
    });

    assert.deepEqual(strategy.calls, []);
  });

  test("skips org repos with a warning", async () => {
    const strategy = new MockStrategy();
    const processor = new CollaboratorsProcessor(
      strategy,
      metadata("Organization")
    );

    const result = await processor.process(
      config({ users: ["bot"] }),
      repo,
      {}
    );

    assert.equal(result.skipped, true);
    assert.equal(result.success, true);
    assert.match(result.warnings?.[0] ?? "", /only apply to personal repos/);
    assert.deepEqual(strategy.calls, []);
  });

  test("skips when no collaborators configured", async () => {
    const meta = metadata();
    const processor = new CollaboratorsProcessor(new MockStrategy(), meta);

    const result = await processor.process(config(), repo, {});

    assert.equal(result.skipped, true);
    assert.equal(meta.called, 0);
  });

  test("reports API failures", async () => {
    const strategy = new MockStrategy();
    strategy.add = async () => {
      throw new Error("HTTP 403");
    };
    const processor = new CollaboratorsProcessor(strategy, metadata());

    const result = await processor.process(
      config({ users: ["bot"] }),
      repo,
      {}
    );

    assert.equal(result.success, false);
    assert.match(result.message, /HTTP 403/);
  });
});
