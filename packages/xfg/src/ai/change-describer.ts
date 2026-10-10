import { createHash } from "node:crypto";
import type { DebugWarnLog } from "../shared/logger.js";
import { isPlainObject, toErrorMessage } from "../shared/type-guards.js";
import {
  CORE_PERMANENT_ERROR_PATTERNS,
  withRetry,
} from "../shared/retry-utils.js";
import type { FileChangeDetail } from "../sync/types.js";
import type {
  AiClientFactory,
  ChangeDescription,
  DescribeInput,
  IChangeDescriber,
  JsonSchema,
} from "./types.js";

export const DEFAULT_MAX_DIFF_CHARS = 20_000;
const MAX_SUBJECT_LENGTH = 72;
const CONVENTIONAL_TYPES = [
  "feat",
  "fix",
  "chore",
  "ci",
  "build",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "revert",
];
const CONVENTIONAL_SUBJECT = new RegExp(
  `^(${CONVENTIONAL_TYPES.join("|")})(\\([a-z0-9._/-]+\\))?!?: \\S.*$`
);

const SYSTEM_PROMPT = `You write git commit messages and pull request summaries for automated configuration sync changes.
You receive the list of changed files with unified diffs. Reply with a JSON object with exactly these keys:
- "subject": a Conventional Commits subject line, at most ${MAX_SUBJECT_LENGTH} characters, format "type(scope): description". type is one of: ${CONVENTIONAL_TYPES.join(", ")}. scope is optional, lowercase, and names the area changed (e.g. workflows, devcontainer, eslint). description is imperative, lowercase, no trailing period, and says what actually changed (e.g. "pin actions/checkout to v5"), never just "sync files".
- "body": the commit body (plain text, wrap at 72 columns). When more than one file or area changed, the body is required: one bullet per area changed ("- "), each saying what changed there. Use an empty string only when a single change is fully described by the subject.
- "prSummary": a short markdown summary for a pull request description (a sentence or a few bullet points). No headings.
Cover every changed file: never describe only one change when there are several.
If the changes do not share one theme, the subject is a broad summary of all of them (e.g. "chore: sync shared tooling config") rather than naming just one.
Pick the type from the effect of the change: ci for CI config, build for build tooling and dev environments, style for formatter/linter config, docs for documentation, chore otherwise.
Only describe what is in the diffs. Do not invent reasons.`;

const RESPONSE_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    subject: { type: "string" },
    body: { type: "string" },
    prSummary: { type: "string" },
  },
  required: ["subject", "body", "prSummary"],
  additionalProperties: false,
};

const AI_PERMANENT_ERROR_PATTERNS = [
  ...CORE_PERMANENT_ERROR_PATTERNS,
  /\b400\b/,
];

// GitHub and GitLab close issues on these keywords; the text is model output shaped by repo content.
const CLOSING_KEYWORD =
  /\b(?:clos(?:e[sd]?|ing)|fix(?:e[sd]|ing)?|resolv(?:e[sd]?|ing)|implement(?:s|ed|ing)?)\b(?=:?\s+(?:[\w.-]+\/[\w.-]+)?#\d|:?\s+https?:\/\/)/gi;
const MENTION = /(^|[^\w`/.@-])@([a-z0-9][a-z0-9-]*(?:\/[\w-]+)?)/gi;

export function neutralizeReferences(text: string): string {
  return text
    .replace(CLOSING_KEYWORD, (word) => (/^[A-Z]/.test(word) ? "Refs" : "refs"))
    .replace(MENTION, "$1`@$2`");
}

export function isConventionalSubject(subject: string): boolean {
  return (
    subject.length <= MAX_SUBJECT_LENGTH && CONVENTIONAL_SUBJECT.test(subject)
  );
}

export function parseDescription(raw: string): ChangeDescription {
  const json = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const parsed: unknown = JSON.parse(json);
  if (!isPlainObject(parsed)) {
    throw new Error("AI response is not a JSON object");
  }

  const text = (value: unknown): string =>
    typeof value === "string" ? neutralizeReferences(value.trim()) : "";

  const subject = text(parsed.subject);
  if (!isConventionalSubject(subject)) {
    throw new Error(
      `AI subject is not a valid conventional commit: "${subject}"`
    );
  }
  const prSummary = text(parsed.prSummary);
  if (!prSummary) {
    throw new Error("AI response is missing prSummary");
  }
  const body = text(parsed.body);

  return { subject, ...(body ? { body } : {}), prSummary };
}

function truncationNote(droppedLines: number, midLine: boolean): string {
  const lines = `${droppedLines} more lines`;
  if (!midLine) return `\n... (truncated ${lines})`;
  return droppedLines > 0
    ? `\n... (truncated mid-line and ${lines})`
    : "\n... (truncated mid-line)";
}

function truncateDiff(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const totalLines = text.split("\n").length;
  // Reserve room for the longest note this diff could need.
  const room = limit - truncationNote(totalLines, true).length;
  if (room <= 0) return "(diff omitted)";
  const cut = text.lastIndexOf("\n", room);
  if (cut === -1) {
    return `${text.slice(0, room)}${truncationNote(totalLines - 1, true)}`;
  }
  const kept = text.slice(0, cut);
  const keptLines = kept.split("\n").length;
  return `${kept}${truncationNote(totalLines - keptLines, false)}`;
}

// Water-filling split: small diffs keep everything, large ones share what is left evenly.
function allocateBudgets(lengths: number[], budget: number): number[] {
  const order = lengths
    .map((length, index) => ({ length, index }))
    .sort((a, b) => a.length - b.length);
  const budgets = new Array<number>(lengths.length).fill(0);
  let remaining = budget;
  order.forEach(({ length, index }, position) => {
    const share = Math.floor(remaining / (order.length - position));
    budgets[index] = Math.min(length, share);
    remaining -= budgets[index];
  });
  return budgets;
}

export function buildUserPrompt(
  files: FileChangeDetail[],
  maxDiffChars: number
): string {
  const diffs = files.map((f) => (f.diffLines ?? []).join("\n"));
  const budgets = allocateBudgets(
    diffs.map((d) => d.length),
    maxDiffChars
  );

  const sections = files.map((file, i) => {
    const header = `### ${file.action} ${file.path}`;
    if (!diffs[i]) return `${header}\n(no text diff)`;
    return `${header}\n${truncateDiff(diffs[i], budgets[i])}`;
  });
  return `Changed files:\n\n${sections.join("\n\n")}`;
}

export class AiChangeDescriber implements IChangeDescriber {
  private readonly cache = new Map<string, Promise<ChangeDescription>>();

  constructor(
    private readonly clientFactory: AiClientFactory,
    private readonly log: DebugWarnLog
  ) {}

  async describe(input: DescribeInput): Promise<ChangeDescription | null> {
    const { options } = input;
    const system = options.prompt
      ? `${SYSTEM_PROMPT}\n\n${options.prompt}`
      : SYSTEM_PROMPT;
    const user = buildUserPrompt(
      input.files,
      options.maxDiffChars ?? DEFAULT_MAX_DIFF_CHARS
    );
    const key = createHash("sha256")
      .update(
        JSON.stringify([
          options.provider,
          options.model,
          options.baseUrl,
          system,
          user,
        ])
      )
      .digest("hex");

    let pending = this.cache.get(key);
    if (pending) {
      this.log.debug("Reusing cached AI commit message");
    } else {
      pending = this.generate(input, system, user);
      this.cache.set(key, pending);
    }

    try {
      return await pending;
    } catch (error) {
      this.cache.delete(key);
      this.log.warn(
        `AI commit message generation failed, using default message: ${toErrorMessage(error)}`
      );
      return null;
    }
  }

  private async generate(
    input: DescribeInput,
    system: string,
    user: string
  ): Promise<ChangeDescription> {
    const client = this.clientFactory(input.options);
    const raw = await withRetry(
      () => client.complete(system, user, RESPONSE_SCHEMA),
      {
        retries: input.retries,
        permanentErrorPatterns: AI_PERMANENT_ERROR_PATTERNS,
      }
    );
    return parseDescription(raw);
  }
}
