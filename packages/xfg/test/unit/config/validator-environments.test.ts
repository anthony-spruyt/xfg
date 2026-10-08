import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import {
  validateRawConfig,
  validateForSync,
  validateSecretsConfig,
  hasActionableSettings,
} from "../../../src/config/validator.js";
import type {
  RawConfig,
  RawRepoSettings,
  RawRootSettings,
} from "../../../src/config/index.js";

const base = (settings?: RawRootSettings, repoSettings?: RawRepoSettings) =>
  ({
    id: "test-config",
    settings,
    repos: [{ git: "git@github.com:me/repo.git", settings: repoSettings }],
  }) as RawConfig;

const asEnvs = (value: unknown) =>
  value as unknown as RawRootSettings["environments"];

describe("settings.environments validation", () => {
  test("accepts a custom policy with branch and tag patterns plus secrets", () => {
    assert.doesNotThrow(() =>
      validateRawConfig(
        base({
          environments: {
            release: {
              deploymentBranchPolicy: {
                custom: [
                  { type: "branch", name: "main" },
                  { type: "tag", name: "v*.*.*" },
                ],
              },
              secrets: { RELEASE_KEY: { env: "RELEASE_KEY" } },
            },
          },
        })
      )
    );
  });

  test("accepts protectedBranches: true and an empty environment", () => {
    assert.doesNotThrow(() =>
      validateRawConfig(
        base({
          environments: {
            prod: { deploymentBranchPolicy: { protectedBranches: true } },
            preview: {},
          },
        })
      )
    );
  });

  test("accepts opt-outs and inherit: false in a repo", () => {
    assert.doesNotThrow(() =>
      validateRawConfig(
        base(
          { environments: { release: {}, staging: {} } },
          {
            environments: {
              inherit: false,
              staging: false,
              release: {
                deploymentBranchPolicy: false,
                secrets: { OLD: false },
              },
            },
          }
        )
      )
    );
  });

  test("rejects non-object environments", () => {
    assert.throws(
      () => validateRawConfig(base({ environments: asEnvs(["release"]) })),
      /environments must be an object/
    );
  });

  test("rejects inherit at root level", () => {
    assert.throws(
      () => validateRawConfig(base({ environments: asEnvs({ inherit: false }) })),
      /'inherit' is not allowed in root-level environments/
    );
  });

  test("rejects a non-boolean inherit in a repo", () => {
    assert.throws(
      () =>
        validateRawConfig(
          base(undefined, {
            environments: { inherit: "no" } as unknown as RawRepoSettings["environments"],
          })
        ),
      /environments\.inherit must be a boolean/
    );
  });

  test("rejects an environment that is neither an object nor false", () => {
    assert.throws(
      () => validateRawConfig(base({ environments: asEnvs({ release: true }) })),
      /environment 'release' must be an object, or false to opt out/
    );
  });

  test("rejects unknown environment keys", () => {
    assert.throws(
      () =>
        validateRawConfig(
          base({ environments: asEnvs({ release: { waitTimer: 5 } }) })
        ),
      /environment 'release': unknown key 'waitTimer'/
    );
  });

  test("rejects an environment name longer than 255 characters", () => {
    const name = "e".repeat(256);
    assert.throws(
      () => validateRawConfig(base({ environments: { [name]: {} } })),
      /exceeds 255 characters/
    );
  });

  test("rejects a blank environment name", () => {
    assert.throws(
      () => validateRawConfig(base({ environments: { "  ": {} } })),
      /environment name must not be blank/
    );
  });

  describe("deploymentBranchPolicy", () => {
    const withPolicy = (policy: unknown) =>
      base({
        environments: asEnvs({ release: { deploymentBranchPolicy: policy } }),
      });

    test("rejects false at root level", () => {
      assert.throws(
        () => validateRawConfig(withPolicy(false)),
        /deploymentBranchPolicy: false is not valid at root level/
      );
    });

    test("rejects a non-object policy", () => {
      assert.throws(
        () => validateRawConfig(withPolicy("main")),
        /deploymentBranchPolicy must be an object/
      );
    });

    test("rejects a policy with neither option", () => {
      assert.throws(
        () => validateRawConfig(withPolicy({})),
        /needs exactly one of 'protectedBranches: true' or 'custom'/
      );
    });

    test("rejects a policy with both options", () => {
      assert.throws(
        () =>
          validateRawConfig(
            withPolicy({
              protectedBranches: true,
              custom: [{ type: "branch", name: "main" }],
            })
          ),
        /needs exactly one of 'protectedBranches: true' or 'custom'/
      );
    });

    test("rejects protectedBranches: false", () => {
      assert.throws(
        () => validateRawConfig(withPolicy({ protectedBranches: false })),
        /protectedBranches must be true/
      );
    });

    test("rejects unknown policy keys", () => {
      assert.throws(
        () => validateRawConfig(withPolicy({ protectedBranches: true, all: 1 })),
        /deploymentBranchPolicy: unknown key 'all'/
      );
    });

    test("rejects an empty custom list", () => {
      assert.throws(
        () => validateRawConfig(withPolicy({ custom: [] })),
        /custom must be a non-empty array/
      );
    });

    test("rejects a custom entry with an invalid type", () => {
      assert.throws(
        () =>
          validateRawConfig(withPolicy({ custom: [{ type: "ref", name: "main" }] })),
        /custom\[0\]\.type must be 'branch' or 'tag'/
      );
    });

    test("rejects a custom entry with a missing name", () => {
      assert.throws(
        () => validateRawConfig(withPolicy({ custom: [{ type: "branch" }] })),
        /custom\[0\]\.name must be a non-empty string/
      );
    });

    test("rejects a custom entry with unknown keys", () => {
      assert.throws(
        () =>
          validateRawConfig(
            withPolicy({ custom: [{ type: "branch", name: "main", id: 1 }] })
          ),
        /custom\[0\]: unknown key 'id'/
      );
    });

    test("rejects duplicate custom patterns", () => {
      assert.throws(
        () =>
          validateRawConfig(
            withPolicy({
              custom: [
                { type: "branch", name: "main" },
                { type: "branch", name: "main" },
              ],
            })
          ),
        /duplicate pattern branch 'main'/
      );
    });

    test("allows the same name as a branch and a tag", () => {
      assert.doesNotThrow(() =>
        validateRawConfig(
          withPolicy({
            custom: [
              { type: "branch", name: "main" },
              { type: "tag", name: "main" },
            ],
          })
        )
      );
    });
  });

  describe("environment secrets", () => {
    const withSecrets = (secrets: unknown) =>
      base({ environments: asEnvs({ release: { secrets } }) });

    test("rejects non-object secrets", () => {
      assert.throws(
        () => validateRawConfig(withSecrets(["KEY"])),
        /environment 'release': secrets must be an object/
      );
    });

    test("rejects a secret that is not an object or false", () => {
      assert.throws(
        () => validateRawConfig(withSecrets({ KEY: "value" })),
        /secret 'KEY' must be an object with an 'env' field, or false to opt out/
      );
    });

    for (const key of ["deleteOrphaned", "inherit"]) {
      test(`rejects ${key} in environment secrets`, () => {
        assert.throws(
          () => validateRawConfig(withSecrets({ [key]: true })),
          new RegExp(`'${key}' is not supported in environment secrets`)
        );
      });
    }
  });
});

describe("validateSecretsConfig - environment secrets", () => {
  test("rejects an invalid environment secret name", () => {
    assert.throws(
      () =>
        validateSecretsConfig(
          base({
            environments: { release: { secrets: { "BAD-NAME": { env: "X" } } } },
          })
        ),
      /Secret name 'BAD-NAME' contains invalid characters/
    );
  });

  test("rejects a missing env source", () => {
    assert.throws(
      () =>
        validateSecretsConfig(
          base({
            environments: {
              release: { secrets: { KEY: {} as unknown as { env: string } } },
            },
          })
        ),
      /Secret 'KEY' requires an 'env' field/
    );
  });

  test("rejects an xfg credential as the source", () => {
    assert.throws(
      () =>
        validateSecretsConfig(
          base({
            environments: { release: { secrets: { KEY: { env: "GH_TOKEN" } } } },
          })
        ),
      /credential/
    );
  });

  test("rejects case-insensitive duplicates", () => {
    assert.throws(
      () =>
        validateSecretsConfig(
          base(undefined, {
            environments: {
              release: { secrets: { KEY: { env: "A" }, key: { env: "B" } } },
            },
          })
        ),
      /Duplicate secret name/
    );
  });

  test("accepts opt-outs", () => {
    assert.doesNotThrow(() =>
      validateSecretsConfig(
        base(undefined, {
          environments: { release: { secrets: { KEY: false } }, other: false },
        })
      )
    );
  });
});

describe("hasActionableSettings - environments", () => {
  test("an environment is actionable for xfg sync", () => {
    assert.equal(hasActionableSettings({ environments: { release: {} } }), true);
  });

  test("only inherit or opt-outs is not actionable", () => {
    assert.equal(
      hasActionableSettings({
        environments: { inherit: false, release: false },
      } as RawRepoSettings),
      false
    );
  });

  test("validateForSync accepts an environments-only config", () => {
    assert.doesNotThrow(() =>
      validateForSync(
        base({
          environments: {
            release: { secrets: { KEY: { env: "KEY_SRC" } } },
          },
        })
      )
    );
  });
});
