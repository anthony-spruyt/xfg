import { postJson, trimTrailingSlash } from "./http.js";
import type { FetchFn, IAiClient, JsonSchema } from "./types.js";

export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5";
const DEFAULT_BASE_URL = "https://api.anthropic.com";
const MAX_TOKENS = 2048;

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string;
}

export interface AnthropicClientOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  fetch: FetchFn;
}

export class AnthropicClient implements IAiClient {
  readonly model: string;
  private readonly apiKey: string;
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly fetch: FetchFn;

  constructor(options: AnthropicClientOptions) {
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.url = `${trimTrailingSlash(options.baseUrl ?? DEFAULT_BASE_URL)}/v1/messages`;
    this.headers = options.headers ?? {};
    this.fetch = options.fetch;
  }

  async complete(
    system: string,
    user: string,
    schema?: JsonSchema
  ): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: "user", content: user }],
    };
    if (schema) {
      body.output_config = { format: { type: "json_schema", schema } };
    }

    const response = (await postJson(
      this.fetch,
      "Anthropic API",
      this.url,
      {
        ...this.headers,
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body
    )) as AnthropicResponse;

    if (response.stop_reason === "refusal") {
      throw new Error("Anthropic API refused the request");
    }
    return (response.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");
  }
}
