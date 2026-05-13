import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { EnvResolver } from "../../../src/shared/env-resolver.js";

describe("EnvResolver", () => {
  test("resolves existing env var", () => {
    const resolver = new EnvResolver({ MY_VAR: "my-value" });
    assert.equal(resolver.resolve("MY_VAR"), "my-value");
  });

  test("throws for missing env var", () => {
    const resolver = new EnvResolver({});
    assert.throws(
      () => resolver.resolve("MISSING"),
      /environment variable.*MISSING.*not set/i
    );
  });

  test("throws for empty env var", () => {
    const resolver = new EnvResolver({ EMPTY: "" });
    assert.throws(
      () => resolver.resolve("EMPTY"),
      /environment variable.*EMPTY.*empty/i
    );
  });

  test("resolveAll returns all values or throws with all missing", () => {
    const resolver = new EnvResolver({ A: "val-a" });
    assert.throws(
      () =>
        resolver.resolveAll([
          { name: "SEC1", envVar: "A" },
          { name: "SEC2", envVar: "B" },
          { name: "SEC3", envVar: "C" },
        ]),
      /B.*C/
    );
  });

  test("resolveAll returns map when all present", () => {
    const resolver = new EnvResolver({ A: "val-a", B: "val-b" });
    const result = resolver.resolveAll([
      { name: "SEC1", envVar: "A" },
      { name: "SEC2", envVar: "B" },
    ]);
    assert.equal(result.get("SEC1"), "val-a");
    assert.equal(result.get("SEC2"), "val-b");
  });
});
