import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import {
  mergeSettings,
  normalizeConfig,
} from "../../../src/config/normalizer.js";
import type {
  RawConfig,
  RawRepoSettings,
} from "../../../src/config/types.js";

const mainOnly = { custom: [{ type: "branch" as const, name: "main" }] };

// The index signature rejects a literal `deleteOrphaned: true` peer key.
const envs = (value: object) =>
  value as NonNullable<RawRepoSettings["environments"]>;

describe("mergeSettings - environments", () => {
  test("inherits root environments when repo has none", () => {
    const result = mergeSettings(
      {
        environments: {
          release: {
            deploymentBranchPolicy: mainOnly,
            secrets: { KEY: { env: "KEY_SRC" } },
          },
        },
      },
      {}
    );
    assert.deepStrictEqual(result?.environments, {
      release: {
        deploymentBranchPolicy: mainOnly,
        secrets: { KEY: { env: "KEY_SRC" } },
      },
    });
  });

  test("repo environment merges with root: policy replaced, secrets merged", () => {
    const result = mergeSettings(
      {
        environments: {
          release: {
            deploymentBranchPolicy: mainOnly,
            secrets: { A: { env: "A_SRC" } },
          },
        },
      },
      {
        environments: {
          release: {
            deploymentBranchPolicy: { protectedBranches: true },
            secrets: { B: { env: "B_SRC" } },
          },
        },
      }
    );
    assert.deepStrictEqual(result?.environments, {
      release: {
        deploymentBranchPolicy: { protectedBranches: true },
        secrets: { A: { env: "A_SRC" }, B: { env: "B_SRC" } },
      },
    });
  });

  test("repo environment without a policy keeps the inherited policy", () => {
    const result = mergeSettings(
      { environments: { release: { deploymentBranchPolicy: mainOnly } } },
      { environments: { release: { secrets: { B: { env: "B_SRC" } } } } }
    );
    assert.deepStrictEqual(result?.environments, {
      release: {
        deploymentBranchPolicy: mainOnly,
        secrets: { B: { env: "B_SRC" } },
      },
    });
  });

  test("deploymentBranchPolicy: false clears the inherited policy", () => {
    const result = mergeSettings(
      { environments: { release: { deploymentBranchPolicy: mainOnly } } },
      { environments: { release: { deploymentBranchPolicy: false } } }
    );
    assert.deepStrictEqual(result?.environments, { release: {} });
  });

  test("secret: false opts out of an inherited environment secret", () => {
    const result = mergeSettings(
      {
        environments: {
          release: { secrets: { A: { env: "A_SRC" }, B: { env: "B_SRC" } } },
        },
      },
      { environments: { release: { secrets: { A: false } } } }
    );
    assert.deepStrictEqual(result?.environments, {
      release: { secrets: { B: { env: "B_SRC" } } },
    });
  });

  test("environment secret names merge case-insensitively, overlay wins", () => {
    const result = mergeSettings(
      { environments: { release: { secrets: { key: { env: "OLD" } } } } },
      { environments: { release: { secrets: { KEY: { env: "NEW" } } } } }
    );
    assert.deepStrictEqual(result?.environments, {
      release: { secrets: { KEY: { env: "NEW" } } },
    });
  });

  test("environment: false opts out of an inherited environment", () => {
    const result = mergeSettings(
      { environments: { release: {}, staging: {} } },
      { environments: { release: false } }
    );
    assert.deepStrictEqual(result?.environments, { staging: {} });
  });

  test("environment: false opts out of an inherited environment regardless of case", () => {
    const result = mergeSettings(
      { environments: { Release: {}, staging: {} } },
      { environments: { release: false } }
    );
    assert.deepStrictEqual(result?.environments, { staging: {} });
  });

  test("environment names merge case-insensitively, overlay key wins", () => {
    const result = mergeSettings(
      {
        environments: {
          Release: {
            deploymentBranchPolicy: mainOnly,
            secrets: { A: { env: "A_SRC" } },
          },
        },
      },
      { environments: { release: { secrets: { B: { env: "B_SRC" } } } } }
    );
    assert.deepStrictEqual(result?.environments, {
      release: {
        deploymentBranchPolicy: mainOnly,
        secrets: { A: { env: "A_SRC" }, B: { env: "B_SRC" } },
      },
    });
  });

  test("a non-object, non-false overlay entry does not rename the base key", () => {
    const result = mergeSettings(
      { environments: { Release: { deploymentBranchPolicy: mainOnly } } },
      {
        environments: { release: true } as unknown as RawRepoSettings["environments"],
      }
    );
    assert.deepStrictEqual(result?.environments, {
      Release: { deploymentBranchPolicy: mainOnly },
    });
  });

  test("inherit: false drops inherited environments", () => {
    const result = mergeSettings(
      { environments: { release: {} } },
      { environments: { inherit: false, staging: {} } }
    );
    assert.deepStrictEqual(result?.environments, { staging: {} });
  });

  test("no environments anywhere leaves the key out", () => {
    const result = mergeSettings({ labels: {} }, {});
    assert.strictEqual(result?.environments, undefined);
  });

  test("an all-opted-out map leaves the key out", () => {
    const result = mergeSettings(
      { environments: { release: {} } },
      { environments: { release: false } }
    );
    assert.strictEqual(result?.environments, undefined);
  });

  test("merging does not share the custom array with the raw config", () => {
    const root = { environments: { release: { deploymentBranchPolicy: mainOnly } } };
    const result = mergeSettings(root, {});
    result!.environments!.release.deploymentBranchPolicy!.custom!.push({
      type: "tag",
      name: "v*",
    });
    assert.equal(mainOnly.custom.length, 1);
  });
});

describe("mergeSettings - environments deleteOrphaned", () => {
  test("root deleteOrphaned is inherited alongside the environments", () => {
    const result = mergeSettings(
      { environments: envs({ deleteOrphaned: true, release: {} }) },
      { environments: { staging: {} } }
    );
    assert.deepStrictEqual(result?.environments, {
      release: {},
      staging: {},
      deleteOrphaned: true,
    });
  });

  test("the repo layer's deleteOrphaned wins", () => {
    const result = mergeSettings(
      { environments: envs({ deleteOrphaned: true, release: {} }) },
      { environments: { deleteOrphaned: false } }
    );
    assert.deepStrictEqual(result?.environments, {
      release: {},
      deleteOrphaned: false,
    });
  });

  test("inherit: false keeps the inherited deleteOrphaned", () => {
    const result = mergeSettings(
      { environments: envs({ deleteOrphaned: true, release: {} }) },
      { environments: { inherit: false, staging: {} } }
    );
    assert.deepStrictEqual(result?.environments, {
      staging: {},
      deleteOrphaned: true,
    });
  });

  test("deleteOrphaned: true alone keeps the map", () => {
    const result = mergeSettings({ environments: envs({ deleteOrphaned: true }) }, {});
    assert.deepStrictEqual(result?.environments, { deleteOrphaned: true });
  });

  test("deleteOrphaned: false alone leaves the key out", () => {
    const result = mergeSettings({ environments: { deleteOrphaned: false } }, {});
    assert.strictEqual(result?.environments, undefined);
  });

  test("environment secrets deleteOrphaned merges innermost-wins", () => {
    const result = mergeSettings(
      {
        environments: envs({
          release: { secrets: { deleteOrphaned: true, A: { env: "A_SRC" } } },
        }),
      },
      { environments: { release: { secrets: { B: { env: "B_SRC" } } } } }
    );
    assert.deepStrictEqual(result?.environments, {
      release: {
        secrets: {
          A: { env: "A_SRC" },
          B: { env: "B_SRC" },
          deleteOrphaned: true,
        },
      },
    });
  });

  test("environment secrets deleteOrphaned alone is kept", () => {
    const result = mergeSettings(
      { environments: envs({ release: { secrets: { deleteOrphaned: true } } }) },
      {}
    );
    assert.deepStrictEqual(result?.environments, {
      release: { secrets: { deleteOrphaned: true } },
    });
  });

  test("environment secrets deleteOrphaned: false alone leaves secrets out", () => {
    const result = mergeSettings(
      { environments: { release: { secrets: { deleteOrphaned: false } } } },
      {}
    );
    assert.deepStrictEqual(result?.environments, { release: {} });
  });

  test("policy deleteOrphaned travels with the policy", () => {
    const policy = { ...mainOnly, deleteOrphaned: true };
    const result = mergeSettings(
      { environments: { release: { deploymentBranchPolicy: policy } } },
      {}
    );
    assert.deepStrictEqual(result?.environments, {
      release: { deploymentBranchPolicy: policy },
    });
  });
});

describe("normalizeConfig - environments via groups", () => {
  test("merges root, group, conditional group and repo layers", () => {
    const raw: RawConfig = {
      id: "test",
      settings: {
        environments: {
          release: {
            deploymentBranchPolicy: mainOnly,
            secrets: { ROOT: { env: "ROOT_SRC" } },
          },
        },
      },
      groups: {
        npm: {
          settings: {
            environments: {
              release: { secrets: { NPM: { env: "NPM_SRC" } } },
            },
          },
        },
      },
      conditionalGroups: [
        {
          when: { allOf: ["npm"] },
          settings: {
            environments: {
              release: {
                deploymentBranchPolicy: {
                  custom: [
                    { type: "branch", name: "main" },
                    { type: "tag", name: "v*.*.*" },
                  ],
                },
              },
            },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["npm"],
          settings: {
            environments: {
              release: { secrets: { ROOT: false, REPO: { env: "REPO_SRC" } } },
            },
          },
        },
      ],
    };

    const result = normalizeConfig(raw, {});
    assert.deepStrictEqual(result.repos[0].settings?.environments, {
      release: {
        deploymentBranchPolicy: {
          custom: [
            { type: "branch", name: "main" },
            { type: "tag", name: "v*.*.*" },
          ],
        },
        secrets: { NPM: { env: "NPM_SRC" }, REPO: { env: "REPO_SRC" } },
      },
    });
  });

  test("group environment: false removes a root environment", () => {
    const raw: RawConfig = {
      id: "test",
      settings: { environments: { release: {} } },
      groups: { plain: { settings: { environments: { release: false } } } },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["plain"] }],
    };

    const result = normalizeConfig(raw, {});
    assert.strictEqual(result.repos[0].settings?.environments, undefined);
  });

  test("group environment merges with a root environment of different case", () => {
    const raw: RawConfig = {
      id: "test",
      settings: {
        environments: { Release: { deploymentBranchPolicy: mainOnly } },
      },
      groups: {
        npm: {
          settings: {
            environments: {
              release: { secrets: { NPM: { env: "NPM_SRC" } } },
            },
          },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["npm"] }],
    };

    const result = normalizeConfig(raw, {});
    assert.deepStrictEqual(result.repos[0].settings?.environments, {
      release: {
        deploymentBranchPolicy: mainOnly,
        secrets: { NPM: { env: "NPM_SRC" } },
      },
    });
  });

  test("group environment: false removes a root environment of different case", () => {
    const raw: RawConfig = {
      id: "test",
      settings: { environments: { Release: {} } },
      groups: { plain: { settings: { environments: { release: false } } } },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["plain"] }],
    };

    const result = normalizeConfig(raw, {});
    assert.strictEqual(result.repos[0].settings?.environments, undefined);
  });

  test("group deleteOrphaned overrides root and survives a later layer", () => {
    const raw: RawConfig = {
      id: "test",
      settings: { environments: { deleteOrphaned: false, release: {} } },
      groups: {
        prune: { settings: { environments: envs({ deleteOrphaned: true }) } },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["prune"],
          settings: { environments: { staging: {} } },
        },
      ],
    };

    const result = normalizeConfig(raw, {});
    assert.deepStrictEqual(result.repos[0].settings?.environments, {
      release: {},
      staging: {},
      deleteOrphaned: true,
    });
  });
});
