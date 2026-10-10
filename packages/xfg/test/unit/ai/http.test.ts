import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { postJson } from "../../../src/ai/http.js";
import type { FetchFn } from "../../../src/ai/types.js";
import { isRateLimitError } from "../../../src/shared/retry-utils.js";
import type { RateLimitedError } from "../../../src/shared/errors.js";

function respond(response: Response): FetchFn {
  return async () => response;
}

async function errorFrom(fetch: FetchFn): Promise<Error> {
  try {
    await postJson(fetch, "Test API", "http://x", {}, {});
  } catch (error) {
    return error as Error;
  }
  assert.fail("expected postJson to throw");
}

describe("postJson", () => {
  test("429 is classified as a rate limit", async () => {
    const error = await errorFrom(
      respond(
        new Response('{"type":"error","error":{"type":"rate_limit_error"}}', {
          status: 429,
        })
      )
    );
    assert.match(error.message, /Test API 429/);
    assert.equal(isRateLimitError(error), true);
  });

  test("429 carries Retry-After seconds", async () => {
    const error = await errorFrom(
      respond(
        new Response("{}", { status: 429, headers: { "retry-after": "17" } })
      )
    );
    assert.equal((error as RateLimitedError).retryAfter, 17);
  });

  test("ignores a non-numeric Retry-After", async () => {
    const error = await errorFrom(
      respond(
        new Response("{}", {
          status: 429,
          headers: { "retry-after": "Wed, 21 Oct 2015 07:28:00 GMT" },
        })
      )
    );
    assert.equal((error as RateLimitedError).retryAfter, undefined);
  });

  test("500 is not a rate limit", async () => {
    const error = await errorFrom(
      respond(new Response("boom", { status: 500 }))
    );
    assert.equal(isRateLimitError(error), false);
  });

  test("non-JSON 200 names the API and previews the body", async () => {
    const error = await errorFrom(
      respond(new Response("<html>gateway</html>", { status: 200 }))
    );
    assert.match(error.message, /Test API/);
    assert.match(error.message, /<html>gateway/);
  });
});

describe("postJson network failures", () => {
  test("names the API and the cause code of a failed request", async () => {
    const failing: FetchFn = async () => {
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("Connect Timeout Error"), {
          code: "UND_ERR_CONNECT_TIMEOUT",
        }),
      });
    };
    const error = await errorFrom(failing);
    assert.match(error.message, /Test API request failed/);
    assert.match(error.message, /fetch failed/);
    assert.match(error.message, /UND_ERR_CONNECT_TIMEOUT/);
  });

  test("a failure without a cause code keeps the message", async () => {
    const failing: FetchFn = async () => {
      throw new Error("boom");
    };
    const error = await errorFrom(failing);
    assert.match(error.message, /Test API request failed: boom/);
  });
});

function listen(
  handler: Parameters<typeof createServer>[1]
): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

describe("postJson redirects", () => {
  test("does not follow a redirect and reports a failure", async () => {
    const targetHits: Array<string | string[] | undefined> = [];
    const target = await listen((req, res) => {
      targetHits.push(req.headers["x-api-key"]);
      res.end("{}");
    });
    const origin = await listen((_req, res) => {
      res.writeHead(302, { location: `${target.url}/elsewhere` });
      res.end();
    });
    try {
      let error: unknown;
      try {
        await postJson(
          globalThis.fetch,
          "Test API",
          origin.url,
          { "x-api-key": "k" },
          {}
        );
      } catch (e) {
        error = e;
      }
      assert.ok(error instanceof Error, "expected postJson to throw");
      assert.match(error.message, /Test API request failed/);
      assert.deepEqual(targetHits, []);
    } finally {
      origin.server.close();
      target.server.close();
    }
  });

  test("asks fetch to reject redirects", async () => {
    let redirect: RequestRedirect | undefined;
    const capture: FetchFn = async (_url, init) => {
      redirect = init.redirect;
      return new Response("{}", { status: 200 });
    };
    await postJson(capture, "Test API", "http://x", {}, {});
    assert.equal(redirect, "error");
  });
});
