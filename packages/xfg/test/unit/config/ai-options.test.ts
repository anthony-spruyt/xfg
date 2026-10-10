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

describe("prOptions.ai credential guard", () => {
  for (const apiKeyEnv of [
    "GH_TOKEN",
    "github_token",
    "XFG_GITHUB_APP_PRIVATE_KEY",
    "OPENAI_API_KEY",
  ]) {
    test(`rejects apiKeyEnv ${apiKeyEnv} for anthropic`, () => {
      assert.throws(
        () =>
          validateRawConfig(
            baseConfig({
              prOptions: { ai: { provider: "anthropic", apiKeyEnv } },
            })
          ),
        /credential/
      );
    });
  }

  test("allows the provider's own key against its default API", () => {
    assert.doesNotThrow(() =>
      validateRawConfig(
        baseConfig({
          prOptions: {
            ai: { provider: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY" },
          },
        })
      )
    );
  });

  test("rejects the provider's own key sent to a custom baseUrl", () => {
    assert.throws(
      () =>
        validateRawConfig(
          baseConfig({
            prOptions: {
              ai: {
                provider: "openai",
                model: "m",
                baseUrl: "https://attacker.example/v1",
                apiKeyEnv: "OPENAI_API_KEY",
              },
            },
          })
        ),
      /credential/
    );
  });

  test("rejects a credential apiKeyEnv in a repo override", () => {
    assert.throws(
      () =>
        validateRawConfig(
          baseConfig({
            repos: [
              {
                git: "git@github.com:org/repo.git",
                prOptions: {
                  ai: { provider: "anthropic", apiKeyEnv: "GH_TOKEN" },
                },
              },
            ],
          })
        ),
      /credential/
    );
  });

  test("allows a dedicated key name for a custom baseUrl", () => {
    assert.doesNotThrow(() =>
      validateRawConfig(
        baseConfig({
          prOptions: {
            ai: {
              provider: "openai",
              model: "m",
              baseUrl: "https://openrouter.ai/api/v1",
              apiKeyEnv: "OPENROUTER_API_KEY",
            },
          },
        })
      )
    );
  });
});

describe("prOptions.ai.headersEnv validation", () => {
  const ai = (extra: Record<string, unknown>) =>
    baseConfig({
      prOptions: {
        ai: {
          provider: "openai",
          model: "m",
          baseUrl: "https://gateway.example.com/v1",
          apiKeyEnv: "GATEWAY_KEY",
          ...extra,
        },
      },
    } as unknown as Partial<RawConfig>);

  test("accepts header name to env var name pairs", () => {
    assert.doesNotThrow(() =>
      validateRawConfig(
        ai({
          headersEnv: {
            "CF-Access-Client-Id": "CF_ACCESS_CLIENT_ID",
            "CF-Access-Client-Secret": "CF_ACCESS_CLIENT_SECRET",
          },
        })
      )
    );
  });

  test("rejects a non-object", () => {
    for (const bad of ["X=Y", ["A"], 3]) {
      assert.throws(
        () => validateRawConfig(ai({ headersEnv: bad })),
        /prOptions\.ai\.headersEnv must be an object/
      );
    }
  });

  test("rejects an empty or non-string env var name", () => {
    for (const bad of ["", 5, null]) {
      assert.throws(
        () => validateRawConfig(ai({ headersEnv: { "X-A": bad } })),
        /prOptions\.ai\.headersEnv\['X-A'\] must be an env var name/
      );
    }
  });

  test("rejects a literal value in place of an env var name", () => {
    assert.throws(
      () =>
        validateRawConfig(
          ai({ headersEnv: { "X-A": "0123-abcd-literal-secret" } })
        ),
      (error: Error) =>
        /must be an env var name/.test(error.message) &&
        !error.message.includes("literal-secret")
    );
  });

  test("rejects an invalid header name", () => {
    assert.throws(
      () => validateRawConfig(ai({ headersEnv: { "Bad Name": "ENV_A" } })),
      /not a valid HTTP header name/
    );
  });

  test("rejects names xfg sets itself, case-insensitively", () => {
    for (const name of [
      "Authorization",
      "X-API-KEY",
      "anthropic-version",
      "Content-Type",
      "Content-Length",
      "Host",
    ]) {
      assert.throws(
        () => validateRawConfig(ai({ headersEnv: { [name]: "ENV_A" } })),
        /reserved/,
        name
      );
    }
  });

  test("rejects duplicate header names that differ only by case", () => {
    assert.throws(
      () =>
        validateRawConfig(
          ai({ headersEnv: { "X-Team": "ENV_A", "x-team": "ENV_B" } })
        ),
      /more than once/
    );
  });

  for (const envName of [
    "GH_TOKEN",
    "github_token",
    "GITLAB_TOKEN",
    "AZURE_DEVOPS_EXT_PAT",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
  ]) {
    test(`rejects credential env var ${envName}`, () => {
      assert.throws(
        () => validateRawConfig(ai({ headersEnv: { "X-A": envName } })),
        /credential xfg uses elsewhere/
      );
    });
  }
});

describe("prOptions.ai.fallback validation", () => {
  const withFallback = (fallback: unknown, primary?: Record<string, unknown>) =>
    baseConfig({
      prOptions: {
        ai: {
          provider: "openai",
          model: "m",
          baseUrl: "https://gateway.example.com/v1",
          apiKeyEnv: "GATEWAY_KEY",
          ...primary,
          fallback,
        },
      },
    } as unknown as Partial<RawConfig>);

  const OPENROUTER = {
    provider: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "anthropic/claude-haiku-4.5",
    apiKeyEnv: "OPENROUTER_API_KEY",
  };

  test("accepts a full fallback provider", () => {
    assert.doesNotThrow(() =>
      validateRawConfig(
        withFallback({
          ...OPENROUTER,
          headersEnv: { "X-Title": "TITLE_ENV" },
          prompt: "p",
          maxDiffChars: 100,
        })
      )
    );
  });

  test("rejects a non-object fallback", () => {
    for (const bad of [true, "x", ["a"]]) {
      assert.throws(
        () => validateRawConfig(withFallback(bad)),
        /prOptions\.ai\.fallback must be an object/
      );
    }
  });

  test("rejects a fallback inside a fallback", () => {
    assert.throws(
      () =>
        validateRawConfig(
          withFallback({ ...OPENROUTER, fallback: { ...OPENROUTER } })
        ),
      /prOptions\.ai\.fallback has unknown key 'fallback'/
    );
  });

  test("rejects unknown keys in the fallback", () => {
    assert.throws(
      () => validateRawConfig(withFallback({ ...OPENROUTER, apiKey: "sk" })),
      /prOptions\.ai\.fallback has unknown key 'apiKey'/
    );
  });

  test("validates fallback fields with the fallback path", () => {
    assert.throws(
      () => validateRawConfig(withFallback({ ...OPENROUTER, provider: "x" })),
      /prOptions\.ai\.fallback\.provider must be one of/
    );
    assert.throws(
      () => validateRawConfig(withFallback({ ...OPENROUTER, model: "" })),
      /prOptions\.ai\.fallback\.model must be a non-empty string/
    );
    assert.throws(
      () => validateRawConfig(withFallback({ ...OPENROUTER, maxDiffChars: 0 })),
      /prOptions\.ai\.fallback\.maxDiffChars must be a positive integer/
    );
    assert.throws(
      () =>
        validateRawConfig(
          withFallback({ provider: "openai", baseUrl: OPENROUTER.baseUrl })
        ),
      /prOptions\.ai\.fallback\.model is required when provider is 'openai'/
    );
    assert.throws(
      () =>
        validateRawConfig(
          withFallback({ ...OPENROUTER, headersEnv: { "X-A": "GH_TOKEN" } })
        ),
      /prOptions\.ai\.fallback\.headersEnv/
    );
  });

  test("applies the key-safety rule to the fallback", () => {
    assert.throws(
      () =>
        validateRawConfig(
          withFallback({ ...OPENROUTER, apiKeyEnv: "OPENAI_API_KEY" })
        ),
      /prOptions\.ai\.fallback\.apiKeyEnv 'OPENAI_API_KEY' is a credential/
    );
    assert.throws(
      () =>
        validateRawConfig(
          withFallback({ ...OPENROUTER, apiKeyEnv: "GH_TOKEN" })
        ),
      /credential/
    );
  });

  test("allows the fallback to use the provider's own key on its own API", () => {
    assert.doesNotThrow(() =>
      validateRawConfig(
        withFallback({ provider: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY" })
      )
    );
  });
});

describe("prOptions.ai.fallback normalization", () => {
  test("defaults the fallback provider to anthropic", () => {
    const result = normalizeConfig(
      baseConfig({
        prOptions: {
          ai: {
            provider: "openai",
            model: "m",
            fallback: { model: "claude-haiku-4-5" },
          },
        },
      }),
      {}
    );
    assert.deepEqual(result.repos[0].prOptions?.ai, {
      provider: "openai",
      model: "m",
      fallback: { provider: "anthropic", model: "claude-haiku-4-5" },
    });
  });

  test("keeps headersEnv and the fallback provider", () => {
    const ai = {
      provider: "openai" as const,
      model: "m",
      headersEnv: { "X-A": "ENV_A" },
      fallback: { provider: "openai" as const, model: "f" },
    };
    const result = normalizeConfig(baseConfig({ prOptions: { ai } }), {});
    assert.deepEqual(result.repos[0].prOptions?.ai, ai);
  });

  test("a repo ai object replaces the root one including its fallback", () => {
    const result = normalizeConfig(
      baseConfig({
        prOptions: {
          ai: { provider: "openai", model: "m", fallback: { model: "f" } },
        },
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
});
