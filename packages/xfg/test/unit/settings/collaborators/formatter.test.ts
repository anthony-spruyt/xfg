import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { formatCollaboratorsPlan } from "../../../../src/settings/collaborators/formatter.js";

const strip = (s: string) =>
  s.replace(new RegExp(String.fromCharCode(0x1b) + "\\[[0-9;]*m", "g"), "");

describe("formatCollaboratorsPlan", () => {
  test("lists creates and deletes with a plan line", () => {
    const result = formatCollaboratorsPlan([
      { action: "delete", username: "old" },
      { action: "delete", username: "late", pending: true, invitationId: 3 },
      { action: "create", username: "bot" },
      { action: "unchanged", username: "keep" },
    ]);
    const lines = result.lines.map(strip);

    assert.ok(
      lines.includes('    + collaborator "bot" (invite)'),
      lines.join("\n")
    );
    assert.ok(lines.includes('    - collaborator "old"'), lines.join("\n"));
    assert.ok(
      lines.includes('    - collaborator "late" (cancel invite)'),
      lines.join("\n")
    );
    assert.ok(
      lines.includes("  Plan: 3 collaborators (1 to invite, 2 to remove)"),
      lines.join("\n")
    );
    assert.equal(result.creates, 1);
    assert.equal(result.deletes, 2);
    assert.equal(result.unchanged, 1);
  });

  test("shows pending invites as a note", () => {
    const result = formatCollaboratorsPlan([
      { action: "unchanged", username: "bot", pending: true, invitationId: 1 },
    ]);
    const lines = result.lines.map(strip);

    assert.ok(
      lines.includes('    collaborator "bot": invite pending'),
      lines.join("\n")
    );
    assert.ok(!lines.some((l) => l.includes("Plan:")));
  });

  test("returns entries for every change", () => {
    const result = formatCollaboratorsPlan([
      { action: "create", username: "bot" },
      { action: "unchanged", username: "keep", pending: true, invitationId: 2 },
    ]);
    assert.deepEqual(result.entries, [
      { name: "bot", action: "create" },
      { name: "keep", action: "unchanged", pending: true },
    ]);
  });

  test("returns no lines when nothing to do", () => {
    const result = formatCollaboratorsPlan([
      { action: "unchanged", username: "bot" },
    ]);
    assert.deepEqual(result.lines, []);
  });
});
