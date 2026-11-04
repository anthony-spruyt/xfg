import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import {
  validateRawConfig,
  validateForSync,
  hasActionableSettings,
} from "../../../src/config/validator.js";
import type { RawConfig } from "../../../src/config/types.js";

function makeConfig(actions: unknown): RawConfig {
  return {
    id: "test",
    settings: { actions },
    repos: [{ git: "https://github.com/org/repo.git" }],
  } as unknown as RawConfig;
}

function accepts(actions: unknown): void {
  assert.doesNotThrow(() => validateRawConfig(makeConfig(actions)));
}

function rejects(actions: unknown, message: RegExp): void {
  assert.throws(() => validateRawConfig(makeConfig(actions)), message);
}

describe("validateRawConfig - actions values", () => {
  test("accepts every field with a valid value", () => {
    accepts({
      enabled: true,
      allowedActions: "selected",
      shaPinningRequired: true,
      githubOwnedAllowed: true,
      verifiedAllowed: false,
      patternsAllowed: ["docker/login-action@*", "!bad/action@*"],
      defaultWorkflowPermissions: "read",
      canApprovePullRequestReviews: false,
      forkPrApprovalPolicy: "all_external_contributors",
      artifactAndLogRetentionDays: 30,
      cacheRetentionDays: 7,
      cacheSizeGb: 10,
    });
  });

  test("accepts an empty patternsAllowed list", () => {
    accepts({ allowedActions: "selected", patternsAllowed: [] });
  });

  test("rejects a non-object actions value", () => {
    rejects("selected", /actions.*must be an object/);
  });

  test("rejects an unknown key", () => {
    rejects({ allowedAction: "all" }, /unknown key 'allowedAction'/);
  });

  for (const field of [
    "enabled",
    "shaPinningRequired",
    "canApprovePullRequestReviews",
  ]) {
    test(`rejects non-boolean ${field}`, () => {
      rejects({ [field]: "yes" }, new RegExp(`${field} must be a boolean`));
    });
  }

  test("rejects an invalid allowedActions", () => {
    rejects(
      { allowedActions: "some" },
      /allowedActions must be one of: all, local_only, selected/
    );
  });

  test("rejects an invalid defaultWorkflowPermissions", () => {
    rejects(
      { defaultWorkflowPermissions: "admin" },
      /defaultWorkflowPermissions must be one of: read, write/
    );
  });

  test("rejects an invalid forkPrApprovalPolicy", () => {
    rejects(
      { forkPrApprovalPolicy: "never" },
      /forkPrApprovalPolicy must be one of: first_time_contributors_new_to_github, first_time_contributors, all_external_contributors/
    );
  });

  test("rejects a non-array patternsAllowed", () => {
    rejects(
      { allowedActions: "selected", patternsAllowed: "a/b@*" },
      /patternsAllowed must be an array of strings/
    );
  });

  test("rejects a blank patternsAllowed entry", () => {
    rejects(
      { allowedActions: "selected", patternsAllowed: ["a/b@*", " "] },
      /patternsAllowed\[1\] must be a non-empty string/
    );
  });

  for (const field of [
    "artifactAndLogRetentionDays",
    "cacheRetentionDays",
    "cacheSizeGb",
  ]) {
    for (const value of [0, -1, 1.5, "7", Number.NaN]) {
      test(`rejects ${field}: ${String(value)}`, () => {
        rejects({ [field]: value }, new RegExp(`${field} must be a positive`));
      });
    }
  }
});

describe("validateRawConfig - actions coupled fields", () => {
  for (const mode of ["all", "local_only"]) {
    for (const field of [
      { githubOwnedAllowed: true },
      { verifiedAllowed: false },
      { patternsAllowed: ["a/b@*"] },
    ]) {
      const name = Object.keys(field)[0];
      test(`rejects ${name} with allowedActions: ${mode} in one layer`, () => {
        rejects(
          { allowedActions: mode, ...field },
          new RegExp(`${name}.*requires allowedActions: selected`)
        );
      });
    }
  }

  test("accepts selected-actions fields with allowedActions: selected", () => {
    accepts({ allowedActions: "selected", githubOwnedAllowed: true });
  });

  test("accepts selected-actions fields without allowedActions in the layer", () => {
    accepts({ githubOwnedAllowed: true });
  });

  for (const field of [
    { allowedActions: "all" },
    { shaPinningRequired: true },
    { githubOwnedAllowed: true },
    { verifiedAllowed: true },
    { patternsAllowed: ["a/b@*"] },
  ]) {
    const name = Object.keys(field)[0];
    test(`rejects ${name} with enabled: false in one layer`, () => {
      rejects(
        { enabled: false, ...field },
        new RegExp(`${name}.*enabled: false`)
      );
    });
  }

  test("accepts enabled: false with fields of other endpoints", () => {
    accepts({ enabled: false, defaultWorkflowPermissions: "read" });
  });
});

describe("validateRawConfig - actions: false opt-out", () => {
  const repoOptOut = (rootActions: unknown) =>
    ({
      id: "test",
      settings:
        rootActions === undefined ? undefined : { actions: rootActions },
      repos: [
        {
          git: "https://github.com/org/repo.git",
          settings: { actions: false },
        },
      ],
    }) as unknown as RawConfig;

  test("rejects actions: false at root level", () => {
    rejects(false, /actions: false is not valid at root level/);
  });

  test("accepts actions: false at repo level when root defines actions", () => {
    assert.doesNotThrow(() =>
      validateRawConfig(repoOptOut({ allowedActions: "all" }))
    );
  });

  test("rejects actions: false at repo level when root has no actions", () => {
    assert.throws(
      () => validateRawConfig(repoOptOut(undefined)),
      /Cannot opt out of actions settings/
    );
  });

  test("accepts actions: false at repo level when a group defines actions", () => {
    const config = {
      id: "test",
      groups: { g: { settings: { actions: { allowedActions: "all" } } } },
      repos: [
        {
          git: "https://github.com/org/repo.git",
          groups: ["g"],
          settings: { actions: false },
        },
      ],
    } as unknown as RawConfig;
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("accepts actions: false at repo level when a conditional group defines actions", () => {
    const config = {
      id: "test",
      groups: { base: {} },
      conditionalGroups: [
        {
          when: { allOf: ["base"] },
          settings: { actions: { allowedActions: "all" } },
        },
      ],
      repos: [
        {
          git: "https://github.com/org/repo.git",
          groups: ["base"],
          settings: { actions: false },
        },
      ],
    } as unknown as RawConfig;
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("accepts actions: false in a group when root defines actions", () => {
    const config = {
      id: "test",
      settings: { actions: { allowedActions: "all" } },
      groups: { priv: { settings: { actions: false } } },
      repos: [{ git: "https://github.com/org/repo.git", groups: ["priv"] }],
    } as unknown as RawConfig;
    assert.doesNotThrow(() => validateRawConfig(config));
  });
});

describe("hasActionableSettings - actions", () => {
  test("returns true when actions has a field", () => {
    assert.equal(hasActionableSettings({ actions: { enabled: true } }), true);
  });

  test("returns false when actions is empty", () => {
    assert.equal(hasActionableSettings({ actions: {} }), false);
  });

  test("returns false when actions is false", () => {
    assert.equal(hasActionableSettings({ actions: false }), false);
  });

  test("validateForSync accepts a config with only settings.actions", () => {
    assert.doesNotThrow(() =>
      validateForSync(makeConfig({ allowedActions: "all" }))
    );
  });

  test("validateForSync rejects a config whose only actions block is empty", () => {
    assert.throws(
      () => validateForSync(makeConfig({})),
      /Config requires at least one of/
    );
  });
});
