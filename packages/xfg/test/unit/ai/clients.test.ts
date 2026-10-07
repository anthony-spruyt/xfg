import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { AnthropicClient } from "../../../src/ai/anthropic-client.js";
import { OpenAICompatibleClient } from "../../../src/ai/openai-compatible-client.js";
import { createAiClient } from "../../../src/ai/client-factory.js";
import type { FetchFn } from "../../../src/ai/types.js";

interface Captured {
  url: string;
  init: RequestInit;
}

function fakeFetch(
  status: number,
  body: unknown
): { fetch: FetchFn; calls: Captured[] } {
  const calls: Captured[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    },
  };
}

function headersOf(init: RequestInit): Record<string, string> {
  return init.headers as Record<string, string>;
}

const SCHEMA = { type: "object" };

describe("AnthropicClient", () => {
  test("posts to /v1/messages with auth, version and body", async () => {
    const { fetch, calls } = fakeFetch(200, {
      content: [{ type: "text", text: '{"a":1}' }],
      stop_reason: "end_turn",
    });
    const client = new AnthropicClient({
      apiKey: "sk-test",
      model: "claude-haiku-4-5",
      fetch,
    });

    const result = await client.complete("sys", "usr", SCHEMA);

    assert.equal(result, '{"a":1}');
    assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
    assert.equal(calls[0].init.method, "POST");
    const headers = headersOf(calls[0].init);
    assert.equal(headers["x-api-key"], "sk-test");
    assert.equal(headers["anthropic-version"], "2023-06-01");
    assert.equal(headers["content-type"], "application/json");
    const body = JSON.parse(calls[0].init.body as string);
    assert.equal(body.model, "claude-haiku-4-5");
    assert.equal(body.system, "sys");
    assert.deepEqual(body.messages, [{ role: "user", content: "usr" }]);
    assert.ok(body.max_tokens > 0);
    assert.deepEqual(body.output_config, {
      format: { type: "json_schema", schema: SCHEMA },
    });
  });

  test("omits output_config when no schema is given", async () => {
    const { fetch, calls } = fakeFetch(200, {
      content: [{ type: "text", text: "hi" }],
    });
    const client = new AnthropicClient({ apiKey: "k", model: "m", fetch });
    await client.complete("s", "u");
    const body = JSON.parse(calls[0].init.body as string);
    assert.equal(body.output_config, undefined);
  });

  test("uses custom baseUrl without trailing slash duplication", async () => {
    const { fetch, calls } = fakeFetch(200, {
      content: [{ type: "text", text: "x" }],
    });
    const client = new AnthropicClient({
      apiKey: "k",
      model: "m",
      baseUrl: "https://proxy.example.com/",
      fetch,
    });
    await client.complete("s", "u");
    assert.equal(calls[0].url, "https://proxy.example.com/v1/messages");
  });

  test("joins multiple text blocks and ignores other blocks", async () => {
    const { fetch } = fakeFetch(200, {
      content: [
        { type: "thinking", thinking: "" },
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ],
    });
    const client = new AnthropicClient({ apiKey: "k", model: "m", fetch });
    assert.equal(await client.complete("s", "u"), "ab");
  });

  test("returns empty text when content or text is missing", async () => {
    const noContent = fakeFetch(200, { stop_reason: "end_turn" });
    const noText = fakeFetch(200, { content: [{ type: "text" }] });
    const a = new AnthropicClient({
      apiKey: "k",
      model: "m",
      fetch: noContent.fetch,
    });
    const b = new AnthropicClient({
      apiKey: "k",
      model: "m",
      fetch: noText.fetch,
    });
    assert.equal(await a.complete("s", "u"), "");
    assert.equal(await b.complete("s", "u"), "");
  });

  test("throws with status code on non-2xx", async () => {
    const { fetch } = fakeFetch(429, { error: { message: "slow down" } });
    const client = new AnthropicClient({ apiKey: "k", model: "m", fetch });
    await assert.rejects(client.complete("s", "u"), /Anthropic API 429/);
  });

  test("throws on refusal", async () => {
    const { fetch } = fakeFetch(200, {
      content: [],
      stop_reason: "refusal",
    });
    const client = new AnthropicClient({ apiKey: "k", model: "m", fetch });
    await assert.rejects(client.complete("s", "u"), /refus/);
  });
});

describe("OpenAICompatibleClient", () => {
  test("posts to {baseUrl}/chat/completions with bearer auth", async () => {
    const { fetch, calls } = fakeFetch(200, {
      choices: [{ message: { content: '{"a":1}' } }],
    });
    const client = new OpenAICompatibleClient({
      apiKey: "sk-oa",
      model: "gpt-x",
      baseUrl: "https://api.openai.com/v1",
      fetch,
    });

    const result = await client.complete("sys", "usr", SCHEMA);

    assert.equal(result, '{"a":1}');
    assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
    const headers = headersOf(calls[0].init);
    assert.equal(headers.authorization, "Bearer sk-oa");
    const body = JSON.parse(calls[0].init.body as string);
    assert.equal(body.model, "gpt-x");
    assert.deepEqual(body.messages, [
      { role: "system", content: "sys" },
      { role: "user", content: "usr" },
    ]);
    assert.deepEqual(body.response_format, { type: "json_object" });
  });

  test("sends no authorization header without a key", async () => {
    const { fetch, calls } = fakeFetch(200, {
      choices: [{ message: { content: "x" } }],
    });
    const client = new OpenAICompatibleClient({
      model: "llama3",
      baseUrl: "http://localhost:11434/v1/",
      fetch,
    });
    await client.complete("s", "u");
    assert.equal(calls[0].url, "http://localhost:11434/v1/chat/completions");
    assert.equal(headersOf(calls[0].init).authorization, undefined);
    const body = JSON.parse(calls[0].init.body as string);
    assert.equal(body.response_format, undefined);
  });

  test("throws with status code on non-2xx", async () => {
    const { fetch } = fakeFetch(500, { error: "boom" });
    const client = new OpenAICompatibleClient({
      model: "m",
      baseUrl: "http://x/v1",
      fetch,
    });
    await assert.rejects(
      client.complete("s", "u"),
      /OpenAI-compatible API 500/
    );
  });

  test("throws when response has no content", async () => {
    const { fetch } = fakeFetch(200, { choices: [] });
    const client = new OpenAICompatibleClient({
      model: "m",
      baseUrl: "http://x/v1",
      fetch,
    });
    await assert.rejects(client.complete("s", "u"), /no content/);
  });
});

describe("createAiClient", () => {
  const { fetch } = fakeFetch(200, {});

  test("anthropic uses ANTHROPIC_API_KEY and default model", () => {
    const client = createAiClient(
      { provider: "anthropic" },
      { ANTHROPIC_API_KEY: "k" },
      fetch
    );
    assert.ok(client instanceof AnthropicClient);
    assert.equal((client as AnthropicClient).model, "claude-haiku-4-5");
  });

  test("anthropic honours apiKeyEnv", () => {
    const client = createAiClient(
      { provider: "anthropic", apiKeyEnv: "MY_KEY" },
      { MY_KEY: "k" },
      fetch
    );
    assert.ok(client instanceof AnthropicClient);
  });

  test("anthropic without key throws a clear error", () => {
    assert.throws(
      () => createAiClient({ provider: "anthropic" }, {}, fetch),
      /ANTHROPIC_API_KEY is not set/
    );
  });

  test("openai uses OPENAI_API_KEY and default base URL", () => {
    const client = createAiClient(
      { provider: "openai", model: "gpt-x" },
      { OPENAI_API_KEY: "k" },
      fetch
    );
    assert.ok(client instanceof OpenAICompatibleClient);
    assert.equal(
      (client as OpenAICompatibleClient).baseUrl,
      "https://api.openai.com/v1"
    );
  });

  test("openai without key throws when no baseUrl", () => {
    assert.throws(
      () => createAiClient({ provider: "openai", model: "gpt-x" }, {}, fetch),
      /OPENAI_API_KEY is not set/
    );
  });

  test("never sends the default provider key to a custom baseUrl", async () => {
    const captured = fakeFetch(200, {
      choices: [{ message: { content: "ok" } }],
    });
    const client = createAiClient(
      {
        provider: "openai",
        model: "m",
        baseUrl: "https://attacker.example/v1",
      },
      { OPENAI_API_KEY: "real-openai-key" },
      captured.fetch
    );
    await client.complete("sys", "user").catch(() => undefined);
    const headers = JSON.stringify(captured.calls.map((c) => c.init.headers));
    assert.ok(!headers.includes("real-openai-key"));
  });

  test("anthropic with a custom baseUrl needs an explicit apiKeyEnv", () => {
    assert.throws(
      () =>
        createAiClient(
          { provider: "anthropic", baseUrl: "https://attacker.example" },
          { ANTHROPIC_API_KEY: "k" },
          fetch
        ),
      /apiKeyEnv/
    );
  });

  test("refuses a credential apiKeyEnv at runtime", () => {
    assert.throws(
      () =>
        createAiClient(
          { provider: "anthropic", apiKeyEnv: "GH_TOKEN" },
          { GH_TOKEN: "t" },
          fetch
        ),
      /credential/
    );
  });

  test("anthropic accepts its default origin spelled out", () => {
    const client = createAiClient(
      { provider: "anthropic", baseUrl: "https://api.anthropic.com/" },
      { ANTHROPIC_API_KEY: "k" },
      fetch
    );
    assert.ok(client instanceof AnthropicClient);
  });

  test("openai with baseUrl does not require a key", () => {
    const client = createAiClient(
      {
        provider: "openai",
        model: "llama3",
        baseUrl: "http://localhost:11434/v1",
      },
      {},
      fetch
    );
    assert.ok(client instanceof OpenAICompatibleClient);
  });

  test("openai without model throws", () => {
    assert.throws(
      () =>
        createAiClient({ provider: "openai" }, { OPENAI_API_KEY: "k" }, fetch),
      /model is required/
    );
  });
});
