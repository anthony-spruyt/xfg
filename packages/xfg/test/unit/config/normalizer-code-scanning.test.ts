import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import {
  mergeSettings,
  normalizeConfig,
} from "../../../src/config/normalizer.js";
import type { RawConfig, RawRepoSettings } from "../../../src/config/types.js";

const repoLayer = (settings: unknown) => settings as RawRepoSettings;

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

  test("a layer that sets only languages inherits state and querySuite", () => {
    const result = mergeSettings(
      { codeScanning: { state: "configured", querySuite: "default" } },
      repoLayer({ codeScanning: { languages: ["go"] } })
    );
    assert.deepStrictEqual(result?.codeScanning, {
      state: "configured",
      querySuite: "default",
      languages: ["go"],
    });
  });

  test("a layer that omits languages inherits them", () => {
    const result = mergeSettings(
      { codeScanning: { state: "configured", languages: ["go"] } },
      repoLayer({ codeScanning: { querySuite: "extended" } })
    );
    assert.deepStrictEqual(result?.codeScanning, {
      state: "configured",
      languages: ["go"],
      querySuite: "extended",
    });
  });

  test("a plain languages list replaces the inherited one", () => {
    const result = mergeSettings(
      { codeScanning: { state: "configured", languages: ["go"] } },
      { codeScanning: { state: "configured", languages: ["python"] } }
    );
    assert.deepStrictEqual(result?.codeScanning?.languages, ["python"]);
  });

  test("an append directive grows the inherited languages", () => {
    const result = mergeSettings(
      { codeScanning: { state: "configured", languages: ["go"] } },
      repoLayer({
        codeScanning: {
          languages: { $arrayMerge: "append", $values: ["python"] },
        },
      })
    );
    assert.deepStrictEqual(result?.codeScanning?.languages, ["go", "python"]);
  });

  test("inherit: false goes back to auto-detect", () => {
    const result = mergeSettings(
      {
        codeScanning: {
          state: "configured",
          querySuite: "extended",
          languages: ["go"],
        },
      },
      repoLayer({ codeScanning: { inherit: false, state: "configured" } })
    );
    assert.deepStrictEqual(result?.codeScanning, { state: "configured" });
  });

  test("inherit: false with no state of its own leaves no state", () => {
    const result = mergeSettings(
      { codeScanning: { state: "configured", languages: ["go"] } },
      repoLayer({ codeScanning: { inherit: false } })
    );
    assert.deepStrictEqual(result?.codeScanning, {});
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

  test("a group and a repo each change one field of the root block", () => {
    const raw = {
      id: "test",
      settings: {
        codeScanning: { state: "configured", querySuite: "default" },
      },
      groups: {
        g: { settings: { codeScanning: { languages: ["go"] } } },
      },
      repos: [
        {
          git: "https://github.com/org/repo.git",
          groups: ["g"],
          settings: { codeScanning: { querySuite: "extended" } },
        },
      ],
    } as unknown as RawConfig;

    const config = normalizeConfig(raw, {});
    assert.deepStrictEqual(config.repos[0].settings?.codeScanning, {
      state: "configured",
      querySuite: "extended",
      languages: ["go"],
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
