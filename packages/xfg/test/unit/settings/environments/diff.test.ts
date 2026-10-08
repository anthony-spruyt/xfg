import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  diffEnvironments,
  currentPolicyKind,
  desiredPolicyKind,
  needsPatternLookup,
  toGitHubPolicy,
} from "../../../../src/settings/environments/diff.js";
import type { GitHubEnvironment } from "../../../../src/settings/environments/types.js";

const custom = { protected_branches: false, custom_branch_policies: true };
const protectedOnly = { protected_branches: true, custom_branch_policies: false };

describe("policy kinds", () => {
  test("currentPolicyKind maps GitHub's policy", () => {
    assert.equal(currentPolicyKind(null), "all");
    assert.equal(currentPolicyKind(protectedOnly), "protected");
    assert.equal(currentPolicyKind(custom), "custom");
    assert.equal(
      currentPolicyKind({ protected_branches: false, custom_branch_policies: false }),
      "all"
    );
  });

  test("desiredPolicyKind maps the config", () => {
    assert.equal(desiredPolicyKind(undefined), "all");
    assert.equal(desiredPolicyKind({ protectedBranches: true }), "protected");
    assert.equal(
      desiredPolicyKind({ custom: [{ type: "branch", name: "main" }] }),
      "custom"
    );
  });

  test("toGitHubPolicy builds the PUT body", () => {
    assert.equal(toGitHubPolicy("all"), null);
    assert.deepEqual(toGitHubPolicy("protected"), protectedOnly);
    assert.deepEqual(toGitHubPolicy("custom"), custom);
  });
});

describe("needsPatternLookup", () => {
  const current: GitHubEnvironment[] = [
    { name: "Release", deployment_branch_policy: custom },
    { name: "prod", deployment_branch_policy: protectedOnly },
  ];

  test("only existing environments that are custom on both sides", () => {
    assert.deepEqual(
      needsPatternLookup(
        {
          release: { deploymentBranchPolicy: { custom: [{ type: "branch", name: "main" }] } },
          prod: { deploymentBranchPolicy: { custom: [{ type: "branch", name: "main" }] } },
          fresh: { deploymentBranchPolicy: { custom: [{ type: "branch", name: "main" }] } },
        },
        current
      ),
      ["Release"]
    );
  });
});

describe("diffEnvironments", () => {
  test("creates a missing environment with its patterns", () => {
    const changes = diffEnvironments(
      {
        release: {
          deploymentBranchPolicy: {
            custom: [
              { type: "branch", name: "main" },
              { type: "tag", name: "v*" },
            ],
          },
        },
      },
      [],
      new Map()
    );
    assert.deepEqual(changes, [
      {
        action: "create",
        name: "release",
        desiredKind: "custom",
        putPolicy: true,
        missingPatterns: [
          { type: "branch", name: "main" },
          { type: "tag", name: "v*" },
        ],
        unmanagedPatterns: [],
        patternsKnown: true,
      },
    ]);
  });

  test("creates an environment with no policy as 'all'", () => {
    const [change] = diffEnvironments({ preview: {} }, [], new Map());
    assert.equal(change.action, "create");
    assert.equal(change.desiredKind, "all");
    assert.equal(change.putPolicy, true);
  });

  test("leaves a matching environment unchanged (case-insensitive name)", () => {
    const [change] = diffEnvironments(
      { prod: { deploymentBranchPolicy: { protectedBranches: true } } },
      [{ name: "Prod", deployment_branch_policy: protectedOnly }],
      new Map()
    );
    assert.equal(change.action, "unchanged");
    assert.equal(change.name, "Prod");
    assert.equal(change.currentKind, "protected");
    assert.equal(change.putPolicy, false);
  });

  test("updates when the policy kind changes", () => {
    const [change] = diffEnvironments(
      { prod: { deploymentBranchPolicy: { custom: [{ type: "branch", name: "main" }] } } },
      [{ name: "prod", deployment_branch_policy: null }],
      new Map()
    );
    assert.equal(change.action, "update");
    assert.equal(change.currentKind, "all");
    assert.equal(change.desiredKind, "custom");
    assert.equal(change.putPolicy, true);
    assert.equal(change.patternsKnown, false);
    assert.deepEqual(change.missingPatterns, [{ type: "branch", name: "main" }]);
  });

  test("adds missing patterns without a PUT and reports unmanaged ones", () => {
    const [change] = diffEnvironments(
      {
        release: {
          deploymentBranchPolicy: {
            custom: [
              { type: "branch", name: "main" },
              { type: "tag", name: "v*" },
            ],
          },
        },
      },
      [{ name: "release", deployment_branch_policy: custom }],
      new Map([
        [
          "release",
          [
            { type: "branch" as const, name: "main" },
            { type: "branch" as const, name: "old" },
          ],
        ],
      ])
    );
    assert.equal(change.action, "update");
    assert.equal(change.putPolicy, false);
    assert.equal(change.patternsKnown, true);
    assert.deepEqual(change.missingPatterns, [{ type: "tag", name: "v*" }]);
    assert.deepEqual(change.unmanagedPatterns, [{ type: "branch", name: "old" }]);
  });

  test("is unchanged when all custom patterns exist", () => {
    const [change] = diffEnvironments(
      { release: { deploymentBranchPolicy: { custom: [{ type: "branch", name: "main" }] } } },
      [{ name: "release", deployment_branch_policy: custom }],
      new Map([["release", [{ type: "branch" as const, name: "main" }]]])
    );
    assert.equal(change.action, "unchanged");
  });

  test("treats a branch and a tag with the same name as different patterns", () => {
    const [change] = diffEnvironments(
      { release: { deploymentBranchPolicy: { custom: [{ type: "tag", name: "main" }] } } },
      [{ name: "release", deployment_branch_policy: custom }],
      new Map([["release", [{ type: "branch" as const, name: "main" }]]])
    );
    assert.deepEqual(change.missingPatterns, [{ type: "tag", name: "main" }]);
    assert.deepEqual(change.unmanagedPatterns, [{ type: "branch", name: "main" }]);
  });
});
