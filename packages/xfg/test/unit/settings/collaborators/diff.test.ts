import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { diffCollaborators } from "../../../../src/settings/collaborators/diff.js";

const base = {
  owner: "me",
  collaborators: [],
  invitations: [],
  desired: [],
  managed: [],
  deleteOrphaned: false,
};

describe("diffCollaborators", () => {
  test("missing user is created", () => {
    const changes = diffCollaborators({ ...base, desired: ["bot"] });
    assert.deepEqual(changes, [{ action: "create", username: "bot" }]);
  });

  test("existing collaborator is unchanged (case-insensitive)", () => {
    const changes = diffCollaborators({
      ...base,
      collaborators: [{ login: "Bot" }],
      desired: ["bot"],
    });
    assert.deepEqual(changes, [{ action: "unchanged", username: "Bot" }]);
  });

  test("pending invite is unchanged and marked pending", () => {
    const changes = diffCollaborators({
      ...base,
      invitations: [{ id: 7, invitee: { login: "bot" } }],
      desired: ["BOT"],
    });
    assert.deepEqual(changes, [
      { action: "unchanged", username: "bot", pending: true, invitationId: 7 },
    ]);
  });

  test("repo owner in config is unchanged", () => {
    const changes = diffCollaborators({ ...base, desired: ["Me"] });
    assert.deepEqual(changes, [{ action: "unchanged", username: "Me" }]);
  });

  test("managed user no longer in config is deleted when deleteOrphaned", () => {
    const changes = diffCollaborators({
      ...base,
      collaborators: [{ login: "Old" }],
      managed: ["old"],
      deleteOrphaned: true,
    });
    assert.deepEqual(changes, [{ action: "delete", username: "Old" }]);
  });

  test("managed pending invite no longer in config is cancelled", () => {
    const changes = diffCollaborators({
      ...base,
      invitations: [{ id: 3, invitee: { login: "old" } }],
      managed: ["old"],
      deleteOrphaned: true,
    });
    assert.deepEqual(changes, [
      { action: "delete", username: "old", pending: true, invitationId: 3 },
    ]);
  });

  test("nothing deleted without deleteOrphaned", () => {
    const changes = diffCollaborators({
      ...base,
      collaborators: [{ login: "old" }],
      managed: ["old"],
    });
    assert.deepEqual(changes, []);
  });

  test("hand-added collaborators are never deleted", () => {
    const changes = diffCollaborators({
      ...base,
      collaborators: [{ login: "human" }],
      deleteOrphaned: true,
    });
    assert.deepEqual(changes, []);
  });

  test("managed user who already left is ignored", () => {
    const changes = diffCollaborators({
      ...base,
      managed: ["gone"],
      deleteOrphaned: true,
    });
    assert.deepEqual(changes, []);
  });

  test("owner is never deleted even if managed", () => {
    const changes = diffCollaborators({
      ...base,
      collaborators: [{ login: "me" }],
      managed: ["me"],
      deleteOrphaned: true,
    });
    assert.deepEqual(changes, []);
  });

  test("managed user still in config is kept", () => {
    const changes = diffCollaborators({
      ...base,
      collaborators: [{ login: "bot" }],
      desired: ["bot"],
      managed: ["bot"],
      deleteOrphaned: true,
    });
    assert.deepEqual(changes, [{ action: "unchanged", username: "bot" }]);
  });

  test("orders deletes, then creates, then unchanged", () => {
    const changes = diffCollaborators({
      ...base,
      collaborators: [{ login: "keep" }, { login: "old" }],
      desired: ["keep", "new"],
      managed: ["old"],
      deleteOrphaned: true,
    });
    assert.deepEqual(
      changes.map((c) => c.action),
      ["delete", "create", "unchanged"]
    );
  });
});
