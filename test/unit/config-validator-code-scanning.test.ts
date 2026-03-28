import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { validateRawConfig } from "../../src/config/validator.js";
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

  test("accepts codeScanning: false at repo level", () => {
    const config = {
      id: "test",
      settings: { codeScanning: { state: "configured" } },
      repos: [
        {
          git: "https://github.com/org/repo.git",
          settings: { codeScanning: false },
        },
      ],
    };
    assert.doesNotThrow(() => validateRawConfig(config));
  });
});
