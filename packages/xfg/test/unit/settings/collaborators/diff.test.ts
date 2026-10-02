import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { diffCollaborators } from "../../../../src/settings/collaborators/diff.js";

const base = {
  owner: "me",
  collaborators: [],
  invitations: [],
  desired: [],
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

  test("collaborator not in config is deleted when deleteOrphaned", () => {
    const changes = diffCollaborators({
      ...base,
      collaborators: [{ login: "Old" }],
      deleteOrphaned: true,
    });
    assert.deepEqual(changes, [{ action: "delete", username: "Old" }]);
  });

  test("pending invite not in config is cancelled when deleteOrphaned", () => {
    const changes = diffCollaborators({
      ...base,
      invitations: [{ id: 3, invitee: { login: "old" } }],
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
      invitations: [{ id: 3, invitee: { login: "other" } }],
    });
    assert.deepEqual(changes, []);
  });

  test("owner is never deleted", () => {
    const changes = diffCollaborators({
      ...base,
      collaborators: [{ login: "ME" }],
      deleteOrphaned: true,
    });
    assert.deepEqual(changes, []);
  });

  test("collaborator still in config is kept (case-insensitive)", () => {
    const changes = diffCollaborators({
      ...base,
      collaborators: [{ login: "Bot" }],
      desired: ["bot"],
      deleteOrphaned: true,
    });
    assert.deepEqual(changes, [{ action: "unchanged", username: "Bot" }]);
  });

  test("invitation without an invitee is ignored", () => {
    const changes = diffCollaborators({
      ...base,
      invitations: [{ id: 9, invitee: null }],
      deleteOrphaned: true,
    });
    assert.deepEqual(changes, []);
  });

  test("expired invite for a desired user is sent again", () => {
    const changes = diffCollaborators({
      ...base,
      invitations: [{ id: 5, invitee: { login: "bot" }, expired: true }],
      desired: ["bot"],
    });
    assert.deepEqual(changes, [
      { action: "create", username: "bot", invitationId: 5 },
    ]);
  });

  test("expired invite not in config is cancelled when deleteOrphaned", () => {
    const changes = diffCollaborators({
      ...base,
      invitations: [{ id: 5, invitee: { login: "old" }, expired: true }],
      deleteOrphaned: true,
    });
    assert.deepEqual(changes, [
      { action: "delete", username: "old", pending: true, invitationId: 5 },
    ]);
  });

  test("orders deletes, then creates, then unchanged", () => {
    const changes = diffCollaborators({
      ...base,
      collaborators: [{ login: "keep" }, { login: "old" }],
      desired: ["keep", "new"],
      deleteOrphaned: true,
    });
    assert.deepEqual(
      changes.map((c) => c.action),
      ["delete", "create", "unchanged"]
    );
  });
});
