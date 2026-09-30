import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { validateRawConfig } from "../../../src/config/validator.js";
import { normalizeConfig } from "../../../src/config/normalizer.js";
import type { RawConfig } from "../../../src/config/index.js";

const baseConfig = (overrides?: Partial<RawConfig>): RawConfig => ({
  id: "test-config",
  files: { "config.json": { content: { key: "value" } } },
  repos: [{ git: "git@github.com:org/repo.git" }],
  ...overrides,
});

describe("prOptions.ai validation", () => {
  test("accepts ai: true", () => {
    assert.doesNotThrow(() =>
      validateRawConfig(baseConfig({ prOptions: { ai: true } }))
    );
  });

  test("accepts ai: false", () => {
    assert.doesNotThrow(() =>
      validateRawConfig(baseConfig({ prOptions: { ai: false } }))
    );
  });

  test("accepts a full anthropic object", () => {
    const config = baseConfig({
      prOptions: {
        ai: {
          provider: "anthropic",
          model: "claude-haiku-4-5",
          apiKeyEnv: "MY_KEY",
          prompt: "Be brief",
          maxDiffChars: 5000,
        },
      },
    });
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("accepts openai with model and baseUrl", () => {
    const config = baseConfig({
      prOptions: {
        ai: {
          provider: "openai",
          model: "llama3",
          baseUrl: "http://localhost:11434/v1",
        },
      },
    });
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("rejects non-boolean non-object ai", () => {
    const config = baseConfig({
      prOptions: { ai: "yes" },
    } as unknown as Partial<RawConfig>);
    assert.throws(
      () => validateRawConfig(config),
      /prOptions\.ai must be a boolean or an object/
    );
  });

  test("rejects unknown provider", () => {
    const config = baseConfig({
      prOptions: { ai: { provider: "gemini" } },
    } as unknown as Partial<RawConfig>);
    assert.throws(
      () => validateRawConfig(config),
      /prOptions\.ai\.provider must be one of: anthropic, openai/
    );
  });

  test("rejects openai without model", () => {
    const config = baseConfig({
      prOptions: { ai: { provider: "openai" } },
    });
    assert.throws(
      () => validateRawConfig(config),
      /prOptions\.ai\.model is required when provider is 'openai'/
    );
  });

  test("rejects non-positive maxDiffChars", () => {
    const config = baseConfig({
      prOptions: { ai: { maxDiffChars: 0 } },
    });
    assert.throws(
      () => validateRawConfig(config),
      /prOptions\.ai\.maxDiffChars must be a positive integer/
    );
  });

  test("rejects non-integer maxDiffChars", () => {
    const config = baseConfig({
      prOptions: { ai: { maxDiffChars: 1.5 } },
    });
    assert.throws(
      () => validateRawConfig(config),
      /prOptions\.ai\.maxDiffChars must be a positive integer/
    );
  });

  test("rejects empty string fields", () => {
    for (const field of ["model", "baseUrl", "apiKeyEnv", "prompt"]) {
      const config = baseConfig({
        prOptions: { ai: { [field]: "" } },
      });
      assert.throws(
        () => validateRawConfig(config),
        new RegExp(`prOptions\\.ai\\.${field} must be a non-empty string`),
        field
      );
    }
  });

  test("rejects unknown keys", () => {
    const config = baseConfig({
      prOptions: { ai: { model: "m", apiKey: "sk-secret" } },
    } as unknown as Partial<RawConfig>);
    assert.throws(
      () => validateRawConfig(config),
      /prOptions\.ai has unknown key 'apiKey'/
    );
  });

  test("validates ai in repo prOptions", () => {
    const config = baseConfig({
      repos: [
        {
          git: "git@github.com:org/repo.git",
          prOptions: { ai: { provider: "openai" } },
        },
      ],
    });
    assert.throws(() => validateRawConfig(config), /model is required/);
  });

  test("validates ai in group prOptions", () => {
    const config = baseConfig({
      groups: { g: { prOptions: { ai: { maxDiffChars: -1 } } } },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["g"] }],
    });
    assert.throws(() => validateRawConfig(config), /maxDiffChars/);
  });

  test("validates ai in conditional group prOptions", () => {
    const config = baseConfig({
      groups: { g: {} },
      conditionalGroups: [
        { when: { allOf: ["g"] }, prOptions: { ai: { provider: "openai" } } },
      ],
      repos: [{ git: "git@github.com:org/repo.git", groups: ["g"] }],
    });
    assert.throws(() => validateRawConfig(config), /model is required/);
  });
});

describe("prOptions.ai normalization", () => {
  test("ai: true becomes anthropic provider", () => {
    const result = normalizeConfig(baseConfig({ prOptions: { ai: true } }), {});
    assert.deepEqual(result.repos[0].prOptions?.ai, { provider: "anthropic" });
  });

  test("object without provider defaults to anthropic", () => {
    const result = normalizeConfig(
      baseConfig({ prOptions: { ai: { prompt: "x" } } }),
      {}
    );
    assert.deepEqual(result.repos[0].prOptions?.ai, {
      provider: "anthropic",
      prompt: "x",
    });
  });

  test("repo ai: false turns off root ai", () => {
    const result = normalizeConfig(
      baseConfig({
        prOptions: { ai: true },
        repos: [
          { git: "git@github.com:org/repo.git", prOptions: { ai: false } },
        ],
      }),
      {}
    );
    assert.equal(result.repos[0].prOptions?.ai, undefined);
  });

  test("repo ai: false keeps other prOptions", () => {
    const result = normalizeConfig(
      baseConfig({
        prOptions: { ai: true, merge: "direct" },
        repos: [
          { git: "git@github.com:org/repo.git", prOptions: { ai: false } },
        ],
      }),
      {}
    );
    assert.deepEqual(result.repos[0].prOptions, { merge: "direct" });
  });

  test("repo ai object replaces root ai object", () => {
    const result = normalizeConfig(
      baseConfig({
        prOptions: { ai: { provider: "openai", model: "gpt" } },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            prOptions: { ai: { prompt: "p" } },
          },
        ],
      }),
      {}
    );
    assert.deepEqual(result.repos[0].prOptions?.ai, {
      provider: "anthropic",
      prompt: "p",
    });
  });

  test("group ai propagates to repo", () => {
    const result = normalizeConfig(
      baseConfig({
        groups: { g: { prOptions: { ai: true } } },
        repos: [{ git: "git@github.com:org/repo.git", groups: ["g"] }],
      }),
      {}
    );
    assert.deepEqual(result.repos[0].prOptions?.ai, { provider: "anthropic" });
  });

  test("ai: true re-enables the inherited ai object", () => {
    const result = normalizeConfig(
      baseConfig({
        prOptions: { ai: { provider: "openai", model: "gpt" } },
        groups: { g: { prOptions: { ai: false } } },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            groups: ["g"],
            prOptions: { ai: true },
          },
        ],
      }),
      {}
    );
    assert.deepEqual(result.repos[0].prOptions, {
      ai: { provider: "openai", model: "gpt" },
    });
  });

  test("ai: true keeps an ai object set above it", () => {
    const result = normalizeConfig(
      baseConfig({
        prOptions: { ai: { provider: "openai", model: "gpt" } },
        repos: [
          { git: "git@github.com:org/repo.git", prOptions: { ai: true } },
        ],
      }),
      {}
    );
    assert.deepEqual(result.repos[0].prOptions?.ai, {
      provider: "openai",
      model: "gpt",
    });
  });

  test("ai unset leaves prOptions untouched", () => {
    const result = normalizeConfig(
      baseConfig({ prOptions: { merge: "manual" } }),
      {}
    );
    assert.deepEqual(result.repos[0].prOptions, { merge: "manual" });
  });
});
