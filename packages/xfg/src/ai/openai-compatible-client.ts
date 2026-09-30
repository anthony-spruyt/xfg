import { postJson, trimTrailingSlash } from "./http.js";
import type { FetchFn, IAiClient, JsonSchema } from "./types.js";

export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

export interface OpenAICompatibleClientOptions {
  apiKey?: string;
  model: string;
  baseUrl: string;
  fetch: FetchFn;
}

export class OpenAICompatibleClient implements IAiClient {
  readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey?: string;
  private readonly fetch: FetchFn;

  constructor(options: OpenAICompatibleClientOptions) {
    this.baseUrl = trimTrailingSlash(options.baseUrl);
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.fetch = options.fetch;
  }

  async complete(
    system: string,
    user: string,
    schema?: JsonSchema
  ): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    };
    // json_object (not json_schema) - the widest-supported mode across Ollama, LiteLLM, Azure.
    if (schema) {
      body.response_format = { type: "json_object" };
    }

    const headers: Record<string, string> = this.apiKey
      ? { authorization: `Bearer ${this.apiKey}` }
      : {};

    const response = (await postJson(
      this.fetch,
      "OpenAI-compatible API",
      `${this.baseUrl}/chat/completions`,
      headers,
      body
    )) as ChatCompletionResponse;

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("OpenAI-compatible API returned no content");
    }
    return content;
  }
}
