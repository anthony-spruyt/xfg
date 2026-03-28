import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import {
  validateRawConfig,
  hasActionableSettings,
} from "../../src/config/validator.js";
import type { RawConfig } from "../../src/config/types.js";

function makeConfig(codeScanning: unknown): RawConfig {
  return {
    id: "test",
    settings: { codeScanning },
    repos: [{ git: "https://github.com/org/repo.git" }],
  } as unknown as RawConfig;
}

describe("validateRawConfig - codeScanning", () => {
  test("accepts valid codeScanning settings", () => {
    assert.doesNotThrow(() =>
      validateRawConfig(
        makeConfig({
          state: "configured",
          querySuite: "extended",
          languages: ["python", "javascript-typescript"],
        })
      )
    );
  });

  test("accepts minimal codeScanning (state only)", () => {
    assert.doesNotThrow(() =>
      validateRawConfig(makeConfig({ state: "configured" }))
    );
  });

  test("rejects codeScanning without state", () => {
    assert.throws(
      () => validateRawConfig(makeConfig({ querySuite: "default" })),
      /state is required/
    );
  });

  test("rejects invalid state value", () => {
    assert.throws(
      () => validateRawConfig(makeConfig({ state: "enabled" })),
      /state must be.*configured.*not-configured/
    );
  });

  test("rejects invalid querySuite value", () => {
    assert.throws(
      () =>
        validateRawConfig(
          makeConfig({ state: "configured", querySuite: "full" })
        ),
      /querySuite must be.*default.*extended/
    );
  });

  test("rejects non-array languages", () => {
    assert.throws(
      () =>
        validateRawConfig(
          makeConfig({ state: "configured", languages: "python" })
        ),
      /languages must be an array/
    );
  });

  test("rejects invalid language value", () => {
    assert.throws(
      () =>
        validateRawConfig(
          makeConfig({ state: "configured", languages: ["rust"] })
        ),
      /invalid language.*rust/i
    );
  });

  test("rejects codeScanning: false at root level", () => {
    assert.throws(
      () => validateRawConfig(makeConfig(false)),
      /codeScanning: false is not valid at root level/
    );
  });

  test("rejects non-object codeScanning", () => {
    assert.throws(
      () => validateRawConfig(makeConfig("configured")),
      /must be an object/
    );
  });

  test("accepts codeScanning: false at repo level", () => {
    const config = {
      id: "test",
      settings: { codeScanning: { state: "configured" as const } },
      repos: [
        {
          git: "https://github.com/org/repo.git",
          settings: { codeScanning: false as const },
        },
      ],
    };
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("accepts codeScanning: false at repo level when group defines codeScanning", () => {
    const config = {
      id: "test",
      groups: {
        scanning: {
          settings: {
            codeScanning: { state: "configured" as const },
          },
        },
      },
      repos: [
        {
          git: "https://github.com/org/repo.git",
          groups: ["scanning"],
          settings: { codeScanning: false as const },
        },
      ],
    };
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("accepts codeScanning: false at repo level when conditionalGroup defines codeScanning", () => {
    const config = {
      id: "test",
      groups: {
        base: {},
      },
      conditionalGroups: [
        {
          when: { allOf: ["base"] },
          settings: {
            codeScanning: { state: "configured" as const },
          },
        },
      ],
      repos: [
        {
          git: "https://github.com/org/repo.git",
          groups: ["base"],
          settings: { codeScanning: false as const },
        },
      ],
    };
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("rejects codeScanning: false at repo level when root has no codeScanning settings", () => {
    const config = {
      id: "test",
      settings: { repo: { visibility: "public" as const } },
      repos: [
        {
          git: "https://github.com/org/repo.git",
          settings: { codeScanning: false as const },
        },
      ],
    };
    assert.throws(
      () => validateRawConfig(config),
      /Cannot opt out of code scanning settings/
    );
  });
});

describe("hasActionableSettings - codeScanning", () => {
  test("returns true when codeScanning is an object", () => {
    assert.equal(
      hasActionableSettings({ codeScanning: { state: "configured" } }),
      true
    );
  });

  test("returns false when codeScanning is false", () => {
    assert.equal(hasActionableSettings({ codeScanning: false }), false);
  });

  test("returns false when settings is undefined", () => {
    assert.equal(hasActionableSettings(undefined), false);
  });
});
