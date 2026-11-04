import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { resolveActionsSettings } from "../../../../src/settings/actions/resolve.js";

describe("resolveActionsSettings", () => {
  test("keeps selected-actions fields when allowedActions is selected", () => {
    const desired = {
      allowedActions: "selected" as const,
      githubOwnedAllowed: true,
      verifiedAllowed: false,
      patternsAllowed: ["a/b@*"],
    };
    const { settings, warnings } = resolveActionsSettings(desired);
    assert.deepStrictEqual(settings, desired);
    assert.deepStrictEqual(warnings, []);
  });

  test("drops selected-actions fields with a warning when allowedActions is not selected", () => {
    const { settings, warnings } = resolveActionsSettings({
      allowedActions: "all",
      githubOwnedAllowed: true,
      patternsAllowed: ["a/b@*"],
    });
    assert.deepStrictEqual(settings, { allowedActions: "all" });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /githubOwnedAllowed, patternsAllowed/);
    assert.match(warnings[0], /allowedActions is "selected"/);
  });

  test("drops selected-actions fields when allowedActions is not configured", () => {
    const { settings, warnings } = resolveActionsSettings({
      verifiedAllowed: true,
      shaPinningRequired: true,
    });
    assert.deepStrictEqual(settings, { shaPinningRequired: true });
    assert.equal(warnings.length, 1);
  });

  test("drops allowedActions, shaPinningRequired and selected fields when enabled is false", () => {
    const { settings, warnings } = resolveActionsSettings({
      enabled: false,
      allowedActions: "selected",
      shaPinningRequired: true,
      patternsAllowed: ["a/b@*"],
      defaultWorkflowPermissions: "read",
    });
    assert.deepStrictEqual(settings, {
      enabled: false,
      defaultWorkflowPermissions: "read",
    });
    assert.equal(warnings.length, 1);
    assert.match(
      warnings[0],
      /allowedActions, shaPinningRequired, patternsAllowed/
    );
    assert.match(warnings[0], /enabled: false/);
  });

  test("does not change its input", () => {
    const desired = { allowedActions: "all" as const, verifiedAllowed: true };
    resolveActionsSettings(desired);
    assert.deepStrictEqual(desired, {
      allowedActions: "all",
      verifiedAllowed: true,
    });
  });

  test("warns nothing when there is nothing to drop", () => {
    const { warnings } = resolveActionsSettings({ enabled: true });
    assert.deepStrictEqual(warnings, []);
  });
});
