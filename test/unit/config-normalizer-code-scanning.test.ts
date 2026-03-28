import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { mergeSettings, normalizeConfig } from "../../src/config/normalizer.js";
import type { RawConfig } from "../../src/config/types.js";

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

  test("both root and repo undefined results in no codeScanning", () => {
    const result = mergeSettings({}, {});
    assert.strictEqual(result?.codeScanning, undefined);
  });
});

describe("normalizeConfig - codeScanning via groups", () => {
  test("group codeScanning overrides root via mergeRawSettings", () => {
    const raw: RawConfig = {
      id: "test",
      settings: {
        codeScanning: { state: "configured", querySuite: "default" },
      },
      groups: {
        override: {
          settings: {
            codeScanning: { state: "configured", querySuite: "extended" },
          },
        },
      },
      repos: [
        {
          git: "https://github.com/org/repo.git",
          groups: ["override"],
        },
      ],
    };

    const config = normalizeConfig(raw, {});
    assert.deepStrictEqual(config.repos[0].settings?.codeScanning, {
      state: "configured",
      querySuite: "extended",
    });
  });

  test("group codeScanning: false opts out via mergeRawSettings", () => {
    const raw: RawConfig = {
      id: "test",
      settings: {
        codeScanning: { state: "configured" },
      },
      groups: {
        optout: {
          settings: {
            codeScanning: false,
          },
        },
      },
      repos: [
        {
          git: "https://github.com/org/repo.git",
          groups: ["optout"],
        },
      ],
    };

    const config = normalizeConfig(raw, {});
    assert.strictEqual(config.repos[0].settings?.codeScanning, undefined);
  });
});
