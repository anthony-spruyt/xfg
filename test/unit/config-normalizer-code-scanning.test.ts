import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { mergeSettings } from "../../src/config/normalizer.js";

describe("mergeSettings - codeScanning", () => {
  test("inherits root codeScanning when repo has none", () => {
    const result = mergeSettings(
      { codeScanning: { state: "configured", querySuite: "default" } },
      {}
    );
    assert.deepStrictEqual(result?.codeScanning, {
      state: "configured",
      querySuite: "default",
    });
  });

  test("repo codeScanning overrides root", () => {
    const result = mergeSettings(
      { codeScanning: { state: "configured", querySuite: "default" } },
      { codeScanning: { state: "configured", querySuite: "extended" } }
    );
    assert.deepStrictEqual(result?.codeScanning, {
      state: "configured",
      querySuite: "extended",
    });
  });

  test("repo codeScanning: false opts out of root", () => {
    const result = mergeSettings(
      { codeScanning: { state: "configured" } },
      { codeScanning: false }
    );
    assert.strictEqual(result?.codeScanning, undefined);
  });

  test("repo codeScanning with no root passes through", () => {
    const result = mergeSettings(undefined, {
      codeScanning: { state: "not-configured" },
    });
    assert.deepStrictEqual(result?.codeScanning, {
      state: "not-configured",
    });
  });
});
