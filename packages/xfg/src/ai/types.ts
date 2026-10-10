import type {
  ResolvedAiConfig,
  ResolvedAiProviderConfig,
} from "../config/index.js";
import type { FileChangeDetail } from "../sync/types.js";

export type AiOptions = ResolvedAiConfig;

export type AiProviderOptions = ResolvedAiProviderConfig;

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export type JsonSchema = Record<string, unknown>;

export interface IAiClient {
  complete(system: string, user: string, schema?: JsonSchema): Promise<string>;
}

export type AiClientFactory = (
  options: AiProviderOptions,
  path?: string
) => IAiClient;

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
