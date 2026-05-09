import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  buildRootSettingsContext,
  validateFileConfigFields,
  validateSettings,
  enrichSettingsContext,
  type RootSettingsContext,
} from "../../../src/config/validators/shared.js";
import { ValidationError } from "../../../src/shared/errors.js";
import type { RawConfig } from "../../../src/config/index.js";

describe("buildRootSettingsContext", () => {
  test("returns empty context when no settings", () => {
    const config: RawConfig = { id: "t", repos: [] };
    const ctx = buildRootSettingsContext(config);
    assert.deepStrictEqual(ctx.rulesetNames, []);
    assert.deepStrictEqual(ctx.labelNames, []);
    assert.equal(ctx.hasRepoSettings, false);
    assert.equal(ctx.hasCodeScanningSettings, false);
  });

  test("extracts ruleset names", () => {
    const config: RawConfig = {
      id: "t",
      repos: [],
      settings: {
        rulesets: {
          "branch-protection": {
            target: "branch",
            enforcement: "active",
            rules: [],
          },
        },
      },
    };
    const ctx = buildRootSettingsContext(config);
    assert.deepStrictEqual(ctx.rulesetNames, ["branch-protection"]);
  });

  test("detects repo settings", () => {
    const config: RawConfig = {
      id: "t",
      repos: [],
      settings: { repo: { description: "test" } },
    };
    const ctx = buildRootSettingsContext(config);
    assert.equal(ctx.hasRepoSettings, true);
  });

  test("repo false means no repo settings", () => {
    const config: RawConfig = {
      id: "t",
      repos: [],
      settings: { repo: false },
    };
    const ctx = buildRootSettingsContext(config);
    assert.equal(ctx.hasRepoSettings, false);
  });

  test("detects code scanning settings", () => {
    const config: RawConfig = {
      id: "t",
      repos: [],
      settings: { codeScanning: { state: "configured" } },
    };
    const ctx = buildRootSettingsContext(config);
    assert.equal(ctx.hasCodeScanningSettings, true);
  });

  test("extracts label names", () => {
    const config: RawConfig = {
      id: "t",
      repos: [],
      settings: {
        labels: {
          bug: { color: "#ff0000" },
        },
      },
    };
    const ctx = buildRootSettingsContext(config);
    assert.deepStrictEqual(ctx.labelNames, ["bug"]);
  });
});

describe("validateFileConfigFields", () => {
  test("accepts valid text content for .sh file", () => {
    assert.doesNotThrow(() =>
      validateFileConfigFields({ content: "#!/bin/bash" }, "setup.sh", "root:")
    );
  });

  test("accepts valid object content for .json file", () => {
    assert.doesNotThrow(() =>
      validateFileConfigFields(
        { content: { key: "val" } },
        "config.json",
        "root:"
      )
    );
  });

  test("rejects object content for text extension", () => {
    assert.throws(
      () =>
        validateFileConfigFields(
          { content: { key: "val" } },
          "readme.txt",
          "root:"
        ),
      ValidationError
    );
  });

  test("rejects string content for structured extension", () => {
    assert.throws(
      () =>
        validateFileConfigFields(
          { content: "plain text" },
          "config.json",
          "root:"
        ),
      ValidationError
    );
  });

  test("rejects invalid content type", () => {
    assert.throws(
      () => validateFileConfigFields({ content: 42 }, "file.txt", "root:"),
      ValidationError
    );
  });

  test("rejects invalid mergeStrategy", () => {
    assert.throws(
      () =>
        validateFileConfigFields(
          { mergeStrategy: "invalid" },
          "file.json",
          "root:"
        ),
      ValidationError
    );
  });

  test("rejects non-boolean createOnly", () => {
    assert.throws(
      () =>
        validateFileConfigFields({ createOnly: "yes" }, "file.txt", "root:"),
      ValidationError
    );
  });

  test("rejects non-string schemaUrl", () => {
    assert.throws(
      () => validateFileConfigFields({ schemaUrl: 123 }, "file.json", "root:"),
      ValidationError
    );
  });

  test("accepts valid header string", () => {
    assert.doesNotThrow(() =>
      validateFileConfigFields({ header: "# Generated" }, "file.txt", "root:")
    );
  });

  test("accepts valid header array", () => {
    assert.doesNotThrow(() =>
      validateFileConfigFields(
        { header: ["# Line 1", "# Line 2"] },
        "file.txt",
        "root:"
      )
    );
  });

  test("rejects non-string header", () => {
    assert.throws(
      () => validateFileConfigFields({ header: 42 }, "file.txt", "root:"),
      ValidationError
    );
  });

  test("rejects vars with non-string values", () => {
    assert.throws(
      () =>
        validateFileConfigFields({ vars: { key: 42 } }, "file.txt", "root:"),
      ValidationError
    );
  });

  test("rejects non-object vars", () => {
    assert.throws(
      () =>
        validateFileConfigFields(
          { vars: "not-an-object" },
          "file.txt",
          "root:"
        ),
      ValidationError
    );
  });
});

describe("validateSettings", () => {
  test("rejects non-object settings", () => {
    assert.throws(() => validateSettings("invalid", "test"), ValidationError);
  });

  test("accepts empty settings object", () => {
    assert.doesNotThrow(() => validateSettings({}, "test"));
  });

  test("rejects non-object rulesets", () => {
    assert.throws(
      () => validateSettings({ rulesets: "bad" }, "test"),
      ValidationError
    );
  });

  test("rejects non-object labels", () => {
    assert.throws(
      () => validateSettings({ labels: "bad" }, "test"),
      ValidationError
    );
  });

  test("rejects non-boolean deleteOrphaned", () => {
    assert.throws(
      () => validateSettings({ deleteOrphaned: "yes" }, "test"),
      ValidationError
    );
  });

  test("accepts boolean deleteOrphaned", () => {
    assert.doesNotThrow(() =>
      validateSettings({ deleteOrphaned: true }, "test")
    );
  });

  test("rejects repo: false at root level (no rootCtx)", () => {
    assert.throws(
      () => validateSettings({ repo: false }, "test"),
      ValidationError
    );
  });

  test("allows repo: false with rootCtx that has repo settings", () => {
    const rootCtx: RootSettingsContext = {
      rulesetNames: [],
      hasRepoSettings: true,
      hasCodeScanningSettings: false,
      labelNames: [],
    };
    assert.doesNotThrow(() =>
      validateSettings({ repo: false }, "test", rootCtx)
    );
  });

  test("rejects repo: false when root has no repo settings", () => {
    const rootCtx: RootSettingsContext = {
      rulesetNames: [],
      hasRepoSettings: false,
      hasCodeScanningSettings: false,
      labelNames: [],
    };
    assert.throws(
      () => validateSettings({ repo: false }, "test", rootCtx),
      ValidationError
    );
  });

  test("rejects codeScanning: false at root level", () => {
    assert.throws(
      () => validateSettings({ codeScanning: false }, "test"),
      ValidationError
    );
  });

  test("allows codeScanning: false with rootCtx that has code scanning", () => {
    const rootCtx: RootSettingsContext = {
      rulesetNames: [],
      hasRepoSettings: false,
      hasCodeScanningSettings: true,
      labelNames: [],
    };
    assert.doesNotThrow(() =>
      validateSettings({ codeScanning: false }, "test", rootCtx)
    );
  });

  test("validates label color format", () => {
    assert.throws(
      () => validateSettings({ labels: { bug: { color: "not-hex" } } }, "test"),
      ValidationError
    );
  });

  test("accepts valid label", () => {
    assert.doesNotThrow(() =>
      validateSettings({ labels: { bug: { color: "#ff0000" } } }, "test")
    );
  });

  test("rejects label description over 100 characters", () => {
    assert.throws(
      () =>
        validateSettings(
          {
            labels: {
              bug: { color: "#ff0000", description: "x".repeat(101) },
            },
          },
          "test"
        ),
      ValidationError
    );
  });

  test("rejects label opt-out for undefined root label", () => {
    const rootCtx: RootSettingsContext = {
      rulesetNames: [],
      hasRepoSettings: false,
      hasCodeScanningSettings: false,
      labelNames: [],
    };
    assert.throws(
      () => validateSettings({ labels: { bug: false } }, "test", rootCtx),
      ValidationError
    );
  });

  test("validates code scanning state", () => {
    assert.throws(
      () => validateSettings({ codeScanning: { state: "invalid" } }, "test"),
      ValidationError
    );
  });

  test("accepts valid code scanning settings", () => {
    assert.doesNotThrow(() =>
      validateSettings({ codeScanning: { state: "configured" } }, "test")
    );
  });

  test("validates code scanning languages", () => {
    assert.throws(
      () =>
        validateSettings(
          {
            codeScanning: {
              state: "configured",
              languages: ["invalid-lang"],
            },
          },
          "test"
        ),
      ValidationError
    );
  });
});

describe("enrichSettingsContext", () => {
  function makeCtx(): RootSettingsContext {
    return {
      rulesetNames: [],
      hasRepoSettings: false,
      hasCodeScanningSettings: false,
      labelNames: [],
    };
  }

  test("no-ops when settings undefined", () => {
    const ctx = makeCtx();
    enrichSettingsContext(ctx, undefined);
    assert.deepStrictEqual(ctx.rulesetNames, []);
  });

  test("adds ruleset names excluding inherit", () => {
    const ctx = makeCtx();
    enrichSettingsContext(ctx, {
      rulesets: {
        "my-rule": { target: "branch", enforcement: "active", rules: [] },
      },
    });
    assert.deepStrictEqual(ctx.rulesetNames, ["my-rule"]);
  });

  test("adds label names excluding inherit", () => {
    const ctx = makeCtx();
    enrichSettingsContext(ctx, {
      labels: {
        bug: { color: "#ff0000" },
      },
    });
    assert.deepStrictEqual(ctx.labelNames, ["bug"]);
  });

  test("sets hasRepoSettings when repo present and not false", () => {
    const ctx = makeCtx();
    enrichSettingsContext(ctx, { repo: { description: "test" } });
    assert.equal(ctx.hasRepoSettings, true);
  });

  test("does not set hasRepoSettings when repo is false", () => {
    const ctx = makeCtx();
    enrichSettingsContext(ctx, { repo: false });
    assert.equal(ctx.hasRepoSettings, false);
  });

  test("sets hasCodeScanningSettings when codeScanning present", () => {
    const ctx = makeCtx();
    enrichSettingsContext(ctx, {
      codeScanning: { state: "configured" },
    });
    assert.equal(ctx.hasCodeScanningSettings, true);
  });
});
