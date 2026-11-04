import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import {
  mergeSettings,
  normalizeConfig,
} from "../../../src/config/normalizer.js";
import type { RawConfig } from "../../../src/config/types.js";

describe("mergeSettings - actions", () => {
  test("inherits root actions when repo has none", () => {
    const result = mergeSettings(
      { actions: { allowedActions: "selected", shaPinningRequired: true } },
      {}
    );
    assert.deepStrictEqual(result?.actions, {
      allowedActions: "selected",
      shaPinningRequired: true,
    });
  });

  test("merges root and repo field by field", () => {
    const result = mergeSettings(
      {
        actions: {
          allowedActions: "selected",
          defaultWorkflowPermissions: "read",
        },
      },
      { actions: { defaultWorkflowPermissions: "write" } }
    );
    assert.deepStrictEqual(result?.actions, {
      allowedActions: "selected",
      defaultWorkflowPermissions: "write",
    });
  });

  test("repo patternsAllowed replaces root patternsAllowed whole", () => {
    const result = mergeSettings(
      {
        actions: {
          allowedActions: "selected",
          patternsAllowed: ["docker/login-action@*", "a/b@*"],
        },
      },
      { actions: { patternsAllowed: ["c/d@*"] } }
    );
    assert.deepStrictEqual(result?.actions?.patternsAllowed, ["c/d@*"]);
  });

  test("repo actions: false opts out of root", () => {
    const result = mergeSettings(
      { actions: { allowedActions: "selected" } },
      { actions: false }
    );
    assert.strictEqual(result?.actions, undefined);
  });

  test("repo actions with no root passes through", () => {
    const result = mergeSettings(undefined, {
      actions: { cacheSizeGb: 5 },
    });
    assert.deepStrictEqual(result?.actions, { cacheSizeGb: 5 });
  });

  test("no actions anywhere leaves actions unset", () => {
    const result = mergeSettings({ repo: { hasWiki: false } }, {});
    assert.strictEqual(result?.actions, undefined);
  });
});

describe("normalizeConfig - actions via groups", () => {
  const base = (settings: RawConfig["settings"]): RawConfig => ({
    id: "test",
    settings: {
      actions: {
        allowedActions: "selected",
        patternsAllowed: ["root/action@*"],
        defaultWorkflowPermissions: "read",
      },
    },
    groups: { g: { settings } },
    repos: [{ git: "https://github.com/org/repo.git", groups: ["g"] }],
  });

  test("group actions merge field by field over root", () => {
    const config = normalizeConfig(
      base({ actions: { defaultWorkflowPermissions: "write" } }),
      {}
    );
    assert.deepStrictEqual(config.repos[0].settings?.actions, {
      allowedActions: "selected",
      patternsAllowed: ["root/action@*"],
      defaultWorkflowPermissions: "write",
    });
  });

  test("group actions: false opts out of root", () => {
    const config = normalizeConfig(base({ actions: false }), {});
    assert.strictEqual(config.repos[0].settings?.actions, undefined);
  });

  test("per-repo actions merge over group over root", () => {
    const raw = base({
      actions: { allowedActions: "all", verifiedAllowed: true },
    });
    raw.repos[0].settings = { actions: { shaPinningRequired: true } };
    const config = normalizeConfig(raw, {});
    assert.deepStrictEqual(config.repos[0].settings?.actions, {
      allowedActions: "all",
      patternsAllowed: ["root/action@*"],
      defaultWorkflowPermissions: "read",
      verifiedAllowed: true,
      shaPinningRequired: true,
    });
  });

  test("per-repo actions apply after a group opted out", () => {
    const raw = base({ actions: false });
    raw.repos[0].settings = { actions: { shaPinningRequired: true } };
    const config = normalizeConfig(raw, {});
    assert.deepStrictEqual(config.repos[0].settings?.actions, {
      shaPinningRequired: true,
    });
  });

  test("conditional group actions merge over root", () => {
    const raw: RawConfig = {
      id: "test",
      settings: { actions: { allowedActions: "selected" } },
      groups: { g: { settings: { repo: { hasWiki: false } } } },
      conditionalGroups: [
        {
          when: { allOf: ["g"] },
          settings: { actions: { shaPinningRequired: true } },
        },
      ],
      repos: [{ git: "https://github.com/org/repo.git", groups: ["g"] }],
    };
    const config = normalizeConfig(raw, {});
    assert.deepStrictEqual(config.repos[0].settings?.actions, {
      allowedActions: "selected",
      shaPinningRequired: true,
    });
  });
});
