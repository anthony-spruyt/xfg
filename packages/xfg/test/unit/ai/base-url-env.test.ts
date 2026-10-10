import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { AiChangeDescriber } from "../../../src/ai/change-describer.js";
import { createAiClient } from "../../../src/ai/client-factory.js";
import type {
  AiOptions,
  FetchFn,
  AiProviderOptions,
} from "../../../src/ai/types.js";
import type { FileChangeDetail } from "../../../src/sync/types.js";

const GATEWAY_URL = "https://gw-9f3a.internal.test/v1";
const VALID = JSON.stringify({
  subject: "chore: update ci",
  body: "",
  prSummary: "Updates CI.",
});

function recordingFetch(): { fetch: FetchFn; urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    fetch: async (url) => {
      urls.push(url);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: VALID } }] })
      );
    },
  };
}

const PRIMARY: AiProviderOptions = {
  provider: "openai",
  model: "m",
  baseUrlEnv: "AI_BASE_URL",
};

describe("createAiClient baseUrlEnv", () => {
  test("posts to the URL held in the env var", async () => {
    const { fetch, urls } = recordingFetch();
    const client = createAiClient(PRIMARY, { AI_BASE_URL: GATEWAY_URL }, fetch);
    await client.complete("s", "u");
    assert.equal(urls[0], `${GATEWAY_URL}/chat/completions`);
  });

  test("trims whitespace and a trailing slash", async () => {
    const { fetch, urls } = recordingFetch();
    const client = createAiClient(
      PRIMARY,
      { AI_BASE_URL: `  ${GATEWAY_URL}/\n` },
      fetch
    );
    await client.complete("s", "u");
    assert.equal(urls[0], `${GATEWAY_URL}/chat/completions`);
  });

  test("works for the anthropic provider", async () => {
    const urls: string[] = [];
    const fetch: FetchFn = async (url) => {
      urls.push(url);
      return new Response(
        JSON.stringify({ content: [{ type: "text", text: "ok" }] })
      );
    };
    const client = createAiClient(
      { provider: "anthropic", apiKeyEnv: "GW_KEY", baseUrlEnv: "AI_BASE_URL" },
      { AI_BASE_URL: "https://gw-9f3a.internal.test", GW_KEY: "k" },
      fetch
    );
    await client.complete("s", "u");
    assert.equal(urls[0], "https://gw-9f3a.internal.test/v1/messages");
  });

  test("accepts http, as baseUrl does", () => {
    assert.doesNotThrow(() =>
      createAiClient(
        PRIMARY,
        { AI_BASE_URL: "http://localhost:11434/v1" },
        recordingFetch().fetch
      )
    );
  });

  for (const [label, env] of [
    ["unset", {}],
    ["empty", { AI_BASE_URL: "" }],
    ["whitespace", { AI_BASE_URL: " \n" }],
  ] as const) {
    test(`an ${label} env var throws an error naming only the var`, () => {
      assert.throws(
        () => createAiClient(PRIMARY, env, recordingFetch().fetch),
        (error: Error) =>
          /AI_BASE_URL is not set/.test(error.message) &&
          /prOptions\.ai\.baseUrlEnv/.test(error.message)
      );
    });
  }

  for (const bad of [
    "not a url",
    "gw-9f3a.internal.test/v1",
    "ftp://gw-9f3a.internal.test/v1",
    "file:///etc/passwd",
    "javascript:alert(1)",
  ]) {
    test(`rejects ${JSON.stringify(bad)} without echoing it`, () => {
      assert.throws(
        () =>
          createAiClient(PRIMARY, { AI_BASE_URL: bad }, recordingFetch().fetch),
        (error: Error) =>
          /AI_BASE_URL/.test(error.message) &&
          !error.message.includes("gw-9f3a") &&
          !error.message.includes("passwd") &&
          !error.message.includes("alert")
      );
    });
  }

  test("refuses baseUrl and baseUrlEnv together", () => {
    assert.throws(
      () =>
        createAiClient(
          { ...PRIMARY, baseUrl: GATEWAY_URL },
          { AI_BASE_URL: GATEWAY_URL },
          recordingFetch().fetch
        ),
      /baseUrl.*baseUrlEnv|mutually exclusive/
    );
  });

  test("refuses credential env var names", () => {
    assert.throws(
      () =>
        createAiClient(
          { ...PRIMARY, baseUrlEnv: "GH_TOKEN" },
          { GH_TOKEN: GATEWAY_URL },
          recordingFetch().fetch
        ),
      /credential/
    );
  });

  test("refuses a value in place of an env var name", () => {
    assert.throws(
      () =>
        createAiClient(
          { ...PRIMARY, baseUrlEnv: GATEWAY_URL },
          {},
          recordingFetch().fetch
        ),
      (error: Error) =>
        /must be an env var name/.test(error.message) &&
        !error.message.includes("gw-9f3a")
    );
  });

  test("the provider's default key is not sent to a URL read from the env", () => {
    assert.throws(
      () =>
        createAiClient(
          { ...PRIMARY, apiKeyEnv: "OPENAI_API_KEY" },
          { AI_BASE_URL: GATEWAY_URL, OPENAI_API_KEY: "sk" },
          recordingFetch().fetch
        ),
      /credential/
    );
  });

  test("the default key is sent when the URL resolves to the provider's own API", async () => {
    const auth: Array<string | undefined> = [];
    const fetch: FetchFn = async (_url, init) => {
      auth.push((init.headers as Record<string, string>).authorization);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: VALID } }] })
      );
    };
    const client = createAiClient(
      PRIMARY,
      { AI_BASE_URL: "https://api.openai.com/v1", OPENAI_API_KEY: "sk-test" },
      fetch
    );
    await client.complete("s", "u");
    assert.deepEqual(auth, ["Bearer sk-test"]);
  });

  test("names the fallback path in errors", () => {
    assert.throws(
      () =>
        createAiClient(
          PRIMARY,
          {},
          recordingFetch().fetch,
          "prOptions.ai.fallback"
        ),
      /prOptions\.ai\.fallback\.baseUrlEnv/
    );
  });
});

describe("AiChangeDescriber with baseUrlEnv", () => {
  const FILES: FileChangeDetail[] = [
    {
      path: "a.json",
      action: "update",
      diffLines: ["@@ -1 +1 @@", "-a", "+b"],
    },
  ];
  const OPTIONS: AiOptions = {
    provider: "openai",
    model: "primary-model",
    baseUrlEnv: "AI_BASE_URL",
    fallback: {
      provider: "openai",
      model: "fallback-model",
      baseUrlEnv: "FALLBACK_BASE_URL",
    },
  };

  function setup(env: Record<string, string | undefined>) {
    const { fetch, urls } = recordingFetch();
    const warnings: string[] = [];
    const describer = new AiChangeDescriber(
      (options, path) => createAiClient(options, env, fetch, path),
      { debug() {}, warn: (m: string) => warnings.push(m) }
    );
    return { describer, urls, warnings };
  }

  test("uses the primary URL when the var is set", async () => {
    const { describer, urls, warnings } = setup({
      AI_BASE_URL: GATEWAY_URL,
      FALLBACK_BASE_URL: "https://fb-77c1.internal.test/v1",
    });
    const result = await describer.describe({
      files: FILES,
      options: OPTIONS,
      retries: 0,
    });
    assert.equal(result?.subject, "chore: update ci");
    assert.deepEqual(urls, [`${GATEWAY_URL}/chat/completions`]);
    assert.deepEqual(warnings, []);
  });

  test("an unset primary var skips to the fallback with a warning that holds no value", async () => {
    const { describer, urls, warnings } = setup({
      FALLBACK_BASE_URL: "https://fb-77c1.internal.test/v1",
    });
    const result = await describer.describe({
      files: FILES,
      options: OPTIONS,
      retries: 0,
    });
    assert.equal(result?.subject, "chore: update ci");
    assert.deepEqual(urls, [
      "https://fb-77c1.internal.test/v1/chat/completions",
    ]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /AI_BASE_URL is not set/);
    assert.ok(!warnings[0].includes("internal.test"));
  });

  test("an invalid primary URL skips to the fallback", async () => {
    const { describer, urls, warnings } = setup({
      AI_BASE_URL: "ftp://gw-9f3a.internal.test",
      FALLBACK_BASE_URL: "https://fb-77c1.internal.test/v1",
    });
    await describer.describe({ files: FILES, options: OPTIONS, retries: 0 });
    assert.deepEqual(urls, [
      "https://fb-77c1.internal.test/v1/chat/completions",
    ]);
    assert.match(warnings[0], /AI_BASE_URL/);
    assert.ok(!warnings[0].includes("gw-9f3a"));
  });

  test("a fallback with baseUrlEnv is used when the primary fails", async () => {
    const { describer, urls } = setup({
      AI_BASE_URL: "nonsense",
      FALLBACK_BASE_URL: "https://fb-77c1.internal.test/v1",
    });
    const result = await describer.describe({
      files: FILES,
      options: OPTIONS,
      retries: 0,
    });
    assert.ok(result);
    assert.equal(urls.length, 1);
    assert.match(urls[0], /^https:\/\/fb-77c1\.internal\.test\//);
  });

  test("returns null when both vars are unset", async () => {
    const { describer, urls, warnings } = setup({});
    const result = await describer.describe({
      files: FILES,
      options: OPTIONS,
      retries: 0,
    });
    assert.equal(result, null);
    assert.deepEqual(urls, []);
    assert.equal(warnings.length, 2);
    assert.match(warnings[1], /FALLBACK_BASE_URL is not set/);
  });

  test("a different baseUrlEnv misses the cache", async () => {
    const { describer, urls } = setup({
      AI_BASE_URL: GATEWAY_URL,
      OTHER_BASE_URL: "https://other-31d2.internal.test/v1",
    });
    const input = { files: FILES, retries: 0 };
    await describer.describe({ ...input, options: OPTIONS });
    await describer.describe({
      ...input,
      options: { ...OPTIONS, baseUrlEnv: "OTHER_BASE_URL" },
    });
    assert.equal(urls.length, 2);
  });
});

describe("baseUrlEnv with credentials in the URL", () => {
  const OPTIONS: AiOptions = {
    provider: "openai",
    model: "m",
    baseUrlEnv: "AI_BASE_URL",
  };
  const FILES: FileChangeDetail[] = [
    { path: "a.json", action: "update", diffLines: ["-a", "+b"] },
  ];

  const HOST = "gw-9f3a.internal.test";
  for (const userinfo of ["alice:s3cr3tpw", "alice", ":s3cr3tpw"]) {
    const bad = ["https://", userinfo, "@", HOST, "/v1"].join("");
    test(`createAiClient rejects ${JSON.stringify(bad)} without echoing it`, () => {
      assert.throws(
        () =>
          createAiClient(PRIMARY, { AI_BASE_URL: bad }, recordingFetch().fetch),
        (error: Error) =>
          /AI_BASE_URL/.test(error.message) &&
          !/gw-9f3a|alice|s3cr3tpw/.test(error.message)
      );
    });

    test(`the describer warns with the var name only for ${JSON.stringify(bad)} using real fetch`, async () => {
      const warnings: string[] = [];
      const describer = new AiChangeDescriber(
        (options, path) =>
          createAiClient(options, { AI_BASE_URL: bad }, globalThis.fetch, path),
        { debug() {}, warn: (m: string) => warnings.push(m) }
      );
      const result = await describer.describe({
        files: FILES,
        options: OPTIONS,
        retries: 0,
      });
      assert.equal(result, null);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /AI_BASE_URL/);
      assert.doesNotMatch(
        warnings[0],
        /gw-9f3a|alice|s3cr3tpw|internal\.test/i
      );
    });
  }
});

describe("baseUrlEnv host redaction", () => {
  const OPTIONS: AiOptions = {
    provider: "openai",
    model: "m",
    baseUrlEnv: "AI_BASE_URL",
  };
  const FILES: FileChangeDetail[] = [
    { path: "a.json", action: "update", diffLines: ["-a", "+b"] },
  ];

  function run(
    options: AiOptions,
    env: Record<string, string>,
    fetch: FetchFn
  ) {
    const warnings: string[] = [];
    const describer = new AiChangeDescriber(
      (o, path) => createAiClient(o, env, fetch, path),
      { debug() {}, warn: (m: string) => warnings.push(m) }
    );
    return {
      warnings,
      result: describer.describe({ files: FILES, options, retries: 0 }),
    };
  }

  test("a non-2xx body that holds the host logs the var name instead", async () => {
    const { warnings, result } = run(
      OPTIONS,
      { AI_BASE_URL: GATEWAY_URL },
      async () =>
        new Response(
          "<h1>502</h1> upstream gw-9f3a.internal.test timed out; Host: GW-9F3A.Internal.TEST",
          { status: 502 }
        )
    );
    assert.equal(await result, null);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /502/);
    assert.match(
      warnings[0],
      /upstream AI_BASE_URL timed out; Host: AI_BASE_URL/
    );
    assert.doesNotMatch(warnings[0], /gw-9f3a|internal\.test/i);
  });

  test("the host and port are both replaced", async () => {
    const { warnings, result } = run(
      OPTIONS,
      { AI_BASE_URL: "https://gw-9f3a.internal.test:8443/v1" },
      async () =>
        new Response("no route to gw-9f3a.internal.test:8443", { status: 503 })
    );
    await result;
    assert.match(warnings[0], /no route to AI_BASE_URL$/);
    assert.doesNotMatch(warnings[0], /gw-9f3a|8443/);
  });

  test("a network error that holds the host logs the var name instead", async () => {
    const { warnings, result } = run(
      OPTIONS,
      { AI_BASE_URL: GATEWAY_URL },
      async () => {
        throw new Error("connect ECONNREFUSED gw-9f3a.internal.test:443");
      }
    );
    await result;
    assert.match(warnings[0], /ECONNREFUSED AI_BASE_URL:443/);
    assert.doesNotMatch(warnings[0], /gw-9f3a/);
  });

  test("the fallback warning is redacted too", async () => {
    const { warnings, result } = run(
      {
        ...OPTIONS,
        fallback: {
          provider: "openai",
          model: "f",
          baseUrlEnv: "FB_BASE_URL",
        },
      },
      {
        AI_BASE_URL: GATEWAY_URL,
        FB_BASE_URL: "https://fb-77c1.internal.test/v1",
      },
      async (url) =>
        new Response(`bad gateway ${new URL(url).host}`, { status: 502 })
    );
    await result;
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /bad gateway AI_BASE_URL/);
    assert.match(warnings[1], /bad gateway FB_BASE_URL/);
    assert.ok(!warnings.join("\n").includes("internal.test"));
  });

  test("status and retry-after still reach the retry logic", async () => {
    const client = createAiClient(
      PRIMARY,
      { AI_BASE_URL: GATEWAY_URL },
      async () =>
        new Response("slow down gw-9f3a.internal.test", {
          status: 429,
          headers: { "retry-after": "7" },
        })
    );
    await assert.rejects(client.complete("s", "u"), (error: Error) => {
      assert.match(error.message, /429 \(rate limit\)/);
      assert.equal((error as Error & { retryAfter?: number }).retryAfter, 7);
      return !error.message.includes("gw-9f3a");
    });
  });

  test("a literal baseUrl is left as written", async () => {
    const { warnings, result } = run(
      { provider: "openai", model: "m", baseUrl: GATEWAY_URL },
      {},
      async () => new Response("down gw-9f3a.internal.test", { status: 502 })
    );
    await result;
    assert.match(warnings[0], /down gw-9f3a\.internal\.test/);
  });
});
