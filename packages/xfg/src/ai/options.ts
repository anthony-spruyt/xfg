import type { PRMergeOptions } from "../config/index.js";
import type { AiOptions } from "./types.js";

export function resolveAiOptions(
  prOptions: PRMergeOptions | undefined
): AiOptions | undefined {
  const ai = prOptions?.ai;
  if (ai === undefined || ai === false) return undefined;
  if (ai === true) return { provider: "anthropic" };
  return { ...ai, provider: ai.provider ?? "anthropic" };
}
