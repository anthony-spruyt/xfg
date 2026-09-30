import type { ResolvedAiConfig } from "../config/index.js";
import type { FileChangeDetail } from "../sync/types.js";

export type AiOptions = ResolvedAiConfig;

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export type JsonSchema = Record<string, unknown>;

export interface IAiClient {
  complete(system: string, user: string, schema?: JsonSchema): Promise<string>;
}

export type AiClientFactory = (options: AiOptions) => IAiClient;

export interface DescribeInput {
  files: FileChangeDetail[];
  options: AiOptions;
  retries: number;
}

export interface ChangeDescription {
  subject: string;
  body?: string;
  prSummary: string;
}

export interface IChangeDescriber {
  describe(input: DescribeInput): Promise<ChangeDescription | null>;
}
