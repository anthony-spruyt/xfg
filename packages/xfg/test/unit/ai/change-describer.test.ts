import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  AiChangeDescriber,
  buildUserPrompt,
  isConventionalSubject,
  parseDescription,
} from "../../../src/ai/change-describer.js";
import type {
  AiOptions,
  IAiClient,
  JsonSchema,
} from "../../../src/ai/types.js";
import type { FileChangeDetail } from "../../../src/sync/types.js";

interface Call {
  system: string;
  user: string;
  schema?: JsonSchema;
}

function fakeClient(responses: Array<string | Error>): {
  client: IAiClient;
  calls: Call[];
} {
  const calls: Call[] = [];
  return {
    calls,
    client: {
      async complete(system, user, schema) {
        calls.push({ system, user, schema });
        const next = responses.shift() ?? responses[responses.length - 1];
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
}

function fakeLog() {
  const warnings: string[] = [];
  return {
    warnings,
    log: { debug() {}, warn: (m: string) => warnings.push(m) },
  };
}

const OPTIONS: AiOptions = { provider: "anthropic" };

const FILES: FileChangeDetail[] = [
  {
    path: ".github/workflows/ci.yaml",
    action: "update",
    diffLines: [
      "@@ -1,1 +1,1 @@",
      "-uses: actions/checkout@v4",
      "+uses: actions/checkout@v5",
    ],
  },
];

const VALID = JSON.stringify({
  subject: "ci(workflows): pin actions/checkout to v5",
  body: "Bumps checkout from v4 to v5.",
  prSummary: "Updates the CI workflow to use actions/checkout v5.",
});

describe("isConventionalSubject", () => {
  test("accepts valid subjects", () => {
    for (const s of [
      "feat: add thing",
      "fix(api): handle null",
      "build(devcontainer): bump node to 22",
      "chore!: drop node 18",
      "ci(workflows)!: require checks",
      "revert: undo x",
    ]) {
      assert.ok(isConventionalSubject(s), s);
    }
  });

  test("rejects invalid subjects", () => {
    for (const s of [
      "update stuff",
      "Feat: add thing",
      "feature: add thing",
      "fix:missing space",
      "fix: ",
      "fix(): empty scope",
      `feat: ${"x".repeat(80)}`,
      "fix: line\nbreak",
    ]) {
      assert.ok(!isConventionalSubject(s), s);
    }
  });
});

describe("parseDescription", () => {
  test("parses valid JSON", () => {
    assert.deepEqual(parseDescription(VALID), {
      subject: "ci(workflows): pin actions/checkout to v5",
      body: "Bumps checkout from v4 to v5.",
      prSummary: "Updates the CI workflow to use actions/checkout v5.",
    });
  });

  test("strips a markdown code fence", () => {
    const result = parseDescription("```json\n" + VALID + "\n```");
    assert.equal(result.subject, "ci(workflows): pin actions/checkout to v5");
  });

  test("drops empty body", () => {
    const result = parseDescription(
      JSON.stringify({ subject: "fix: x", body: "  ", prSummary: "s" })
    );
    assert.equal(result.body, undefined);
  });

  test("wraps @mentions in backticks so they do not notify", () => {
    const result = parseDescription(
      JSON.stringify({
        subject: "chore: bump @types/node",
        body: "Ask @alice or @org/platform-team.",
        prSummary: "cc @bob, mail a@b.com, uses actions/checkout@v5",
      })
    );
    assert.equal(result.subject, "chore: bump `@types/node`");
    assert.equal(result.body, "Ask `@alice` or `@org/platform-team`.");
    assert.equal(
      result.prSummary,
      "cc `@bob`, mail a@b.com, uses actions/checkout@v5"
    );
  });

  test("turns issue-closing keywords into plain references", () => {
    const result = parseDescription(
      JSON.stringify({
        subject: "fix: close #7",
        body: "Fixes #42 and resolves: org/repo#9.",
        prSummary:
          "Closes https://github.com/org/repo/issues/3, fixed the fixes",
      })
    );
    assert.equal(result.subject, "fix: refs #7");
    assert.equal(result.body, "Refs #42 and refs: org/repo#9.");
    assert.equal(
      result.prSummary,
      "Refs https://github.com/org/repo/issues/3, fixed the fixes"
    );
  });

  test("trims the subject", () => {
    const result = parseDescription(
      JSON.stringify({ subject: " fix: x ", prSummary: "s" })
    );
    assert.equal(result.subject, "fix: x");
  });

  test("throws on non-conventional subject", () => {
    assert.throws(
      () =>
        parseDescription(
          JSON.stringify({ subject: "Update files", prSummary: "s" })
        ),
      /conventional commit/
    );
  });

  test("throws on missing subject", () => {
    assert.throws(
      () => parseDescription(JSON.stringify({ prSummary: "s" })),
      /conventional commit/
    );
  });

  test("throws on missing prSummary", () => {
    assert.throws(
      () => parseDescription(JSON.stringify({ subject: "fix: x" })),
      /prSummary/
    );
  });

  test("throws on non-object JSON", () => {
    assert.throws(() => parseDescription("[]"), /JSON object/);
  });

  test("throws on invalid JSON", () => {
    assert.throws(() => parseDescription("not json"));
  });
});

describe("buildUserPrompt", () => {
  test("includes paths, actions and diffs", () => {
    const prompt = buildUserPrompt(FILES, 20000);
    assert.match(prompt, /update \.github\/workflows\/ci\.yaml/);
    assert.match(prompt, /\+uses: actions\/checkout@v5/);
  });

  test("notes files without a text diff", () => {
    const prompt = buildUserPrompt(
      [{ path: "logo.png", action: "create" }],
      20000
    );
    assert.match(prompt, /logo\.png/);
    assert.match(prompt, /no text diff/);
  });

  test("truncates a single long line without newlines", () => {
    const prompt = buildUserPrompt(
      [
        {
          path: "min.js",
          action: "create",
          diffLines: ["+" + "x".repeat(5000)],
        },
      ],
      500
    );
    assert.match(prompt, /truncated/);
    assert.ok(prompt.length < 1500, `prompt too long: ${prompt.length}`);
  });

  test("truncation note counts toward the cap", () => {
    const lines = Array.from({ length: 500 }, (_, i) => `+line ${i}`);
    const header = "Changed files:\n\n### create a.txt\n";
    const prompt = buildUserPrompt(
      [{ path: "a.txt", action: "create", diffLines: lines }],
      1000
    );
    assert.ok(prompt.startsWith(header));
    const diff = prompt.slice(header.length);
    assert.ok(diff.length <= 1000, `diff too long: ${diff.length}`);
    const kept = diff.split("\n").length - 1;
    assert.match(diff, new RegExp(`truncated ${500 - kept} more lines`));
  });

  test("a line cut partway is reported as cut mid-line", () => {
    const prompt = buildUserPrompt(
      [
        {
          path: "min.js",
          action: "create",
          diffLines: ["+" + "x".repeat(5000)],
        },
      ],
      500
    );
    assert.match(prompt, /\n\.\.\. \(truncated mid-line\)$/);
  });

  test("a line cut partway also counts the lines after it", () => {
    const prompt = buildUserPrompt(
      [
        {
          path: "min.js",
          action: "create",
          diffLines: ["+" + "x".repeat(5000), "+a", "+b"],
        },
      ],
      500
    );
    assert.match(prompt, /truncated mid-line and 2 more lines/);
  });

  test("omits diffs whose share cannot fit the truncation note", () => {
    const files: FileChangeDetail[] = Array.from({ length: 20 }, (_, i) => ({
      path: `f${i}.txt`,
      action: "update" as const,
      diffLines: ["+" + "x".repeat(5000)],
    }));
    const prompt = buildUserPrompt(files, 100);
    assert.doesNotMatch(prompt, /truncated/);
    assert.equal(prompt.match(/\(diff omitted\)/g)?.length, 20);
  });

  test("keeps diff text plus notes within the cap", () => {
    const lines = (n: number) =>
      Array.from({ length: n }, (_, i) => `+line ${i}`);
    const files: FileChangeDetail[] = Array.from({ length: 7 }, (_, i) => ({
      path: `f${i}.txt`,
      action: "update" as const,
      diffLines: lines(300 + i * 50),
    }));
    const prompt = buildUserPrompt(files, 900);
    const diffText = prompt
      .split(/\n*### update f\d\.txt\n/)
      .slice(1)
      .join("");
    assert.ok(diffText.length <= 900, `diff text too long: ${diffText.length}`);
  });

  test("respects the diff cap and truncates fairly", () => {
    const big = (n: number) =>
      Array.from({ length: n }, (_, i) => `+line ${i}`);
    const files: FileChangeDetail[] = [
      { path: "small.txt", action: "create", diffLines: ["+tiny"] },
      { path: "a.txt", action: "create", diffLines: big(2000) },
      { path: "b.txt", action: "create", diffLines: big(2000) },
    ];
    const prompt = buildUserPrompt(files, 1000);
    const diffChars = prompt.length;
    assert.ok(diffChars < 1000 + 600, `prompt too long: ${diffChars}`);
    assert.match(prompt, /\+tiny/);
    assert.match(prompt, /a\.txt/);
    assert.match(prompt, /b\.txt/);
    assert.match(prompt, /\+line 0/);
    assert.match(prompt, /truncated/);
    const aStart = prompt.indexOf("a.txt");
    const bStart = prompt.indexOf("b.txt");
    const aLen = bStart - aStart;
    const bLen = prompt.length - bStart;
    assert.ok(Math.abs(aLen - bLen) < 100, `unfair split: ${aLen} vs ${bLen}`);
  });
});

describe("AiChangeDescriber", () => {
  test("returns parsed description and sends schema", async () => {
    const { client, calls } = fakeClient([VALID]);
    const { log } = fakeLog();
    const describer = new AiChangeDescriber(() => client, log);

    const result = await describer.describe({
      files: FILES,
      options: OPTIONS,
      retries: 0,
    });

    assert.equal(result?.subject, "ci(workflows): pin actions/checkout to v5");
    assert.equal(calls.length, 1);
    assert.ok(calls[0].schema);
    assert.match(calls[0].user, /actions\/checkout@v5/);
  });

  test("system prompt asks the model to cover every changed area", async () => {
    const { client, calls } = fakeClient([VALID]);
    const { log } = fakeLog();
    const describer = new AiChangeDescriber(() => client, log);
    await describer.describe({ files: FILES, options: OPTIONS, retries: 0 });
    const { system } = calls[0];
    assert.match(system, /subject must cover all changes/);
    assert.match(
      system,
      /Name the changed areas in it when they fit \(e\.g\. "chore: update <area>, <area> and <area>"\); use a broader summary only when they do not/
    );
    assert.match(
      system,
      /Use a scope only when a single area changed[^\n]*; omit the scope when more than one area changed/
    );
    assert.match(system, /When the changes span more than one type, use chore/);
    assert.doesNotMatch(
      system,
      /devcontainer|concurrency|agent rules|superseded/i,
      "examples must not echo a real sync the model could copy"
    );
    assert.match(system, /never a subject that names just one of several/);
    assert.match(
      system,
      /more than one area changed, the body is required: one bullet per area/
    );
    assert.match(
      system,
      /names the concrete thing that changed \(tool, rule, setting or key, version\)/
    );
    assert.match(system, /effect as read directly from the diff/);
    assert.match(
      system,
      /\(e\.g\. "enable no-unused-vars so lint fails on unused variables", not just "update eslint config"\)/,
      "bullet example must name the rule together with its effect"
    );
    assert.doesNotMatch(system, /not "add no-unused-vars rule"/);
    assert.match(system, /do not guess motives/);
    assert.doesNotMatch(system, /Do not invent reasons/);
    assert.match(
      system,
      /Names of things \(tools, rules, settings\) are fine; file names and paths are not/
    );
    assert.match(system, /"prSummary":[^\n]*covers every changed area/);
    assert.match(system, /empty string only when a single change/);
    assert.doesNotMatch(system, /if the subject says it all/);
  });

  test("appends custom prompt to the system prompt", async () => {
    const { client, calls } = fakeClient([VALID]);
    const { log } = fakeLog();
    const describer = new AiChangeDescriber(() => client, log);
    await describer.describe({
      files: FILES,
      options: { ...OPTIONS, prompt: "Mention the ticket XFG-1." },
      retries: 0,
    });
    assert.match(calls[0].system, /conventional commit/i);
    assert.match(calls[0].system, /Mention the ticket XFG-1\.$/);
  });

  test("returns null and warns on non-conventional subject", async () => {
    const { client } = fakeClient([
      JSON.stringify({ subject: "Update files", prSummary: "x" }),
    ]);
    const { log, warnings } = fakeLog();
    const describer = new AiChangeDescriber(() => client, log);
    const result = await describer.describe({
      files: FILES,
      options: OPTIONS,
      retries: 0,
    });
    assert.equal(result, null);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /AI commit message generation failed/);
  });

  test("returns null when the client throws", async () => {
    const { client } = fakeClient([new Error("Anthropic API 400: bad")]);
    const { log, warnings } = fakeLog();
    const describer = new AiChangeDescriber(() => client, log);
    const result = await describer.describe({
      files: FILES,
      options: OPTIONS,
      retries: 0,
    });
    assert.equal(result, null);
    assert.match(warnings[0], /400/);
  });

  test("returns null when the client factory throws", async () => {
    const { log, warnings } = fakeLog();
    const describer = new AiChangeDescriber(() => {
      throw new Error("ANTHROPIC_API_KEY is not set");
    }, log);
    const result = await describer.describe({
      files: FILES,
      options: OPTIONS,
      retries: 0,
    });
    assert.equal(result, null);
    assert.match(warnings[0], /ANTHROPIC_API_KEY/);
  });

  test("retries transient errors", async () => {
    const { client, calls } = fakeClient([
      new Error("Anthropic API 503: overloaded"),
      VALID,
    ]);
    const { log } = fakeLog();
    const describer = new AiChangeDescriber(() => client, log);
    const result = await describer.describe({
      files: FILES,
      options: OPTIONS,
      retries: 1,
    });
    assert.ok(result);
    assert.equal(calls.length, 2);
  });

  test("cache hit makes no second call", async () => {
    const { client, calls } = fakeClient([VALID]);
    const { log } = fakeLog();
    const describer = new AiChangeDescriber(() => client, log);
    const input = { files: FILES, options: OPTIONS, retries: 0 };

    const first = await describer.describe(input);
    const second = await describer.describe({ ...input, files: [...FILES] });

    assert.deepEqual(first, second);
    assert.equal(calls.length, 1);
  });

  test("different options miss the cache", async () => {
    const { client, calls } = fakeClient([VALID]);
    const { log } = fakeLog();
    const describer = new AiChangeDescriber(() => client, log);
    await describer.describe({ files: FILES, options: OPTIONS, retries: 0 });
    await describer.describe({
      files: FILES,
      options: { ...OPTIONS, model: "claude-sonnet-5-5" },
      retries: 0,
    });
    assert.equal(calls.length, 2);
  });

  test("failures are not cached", async () => {
    const { client, calls } = fakeClient([
      new Error("Anthropic API 400"),
      VALID,
    ]);
    const { log } = fakeLog();
    const describer = new AiChangeDescriber(() => client, log);
    const input = { files: FILES, options: OPTIONS, retries: 0 };
    assert.equal(await describer.describe(input), null);
    assert.ok(await describer.describe(input));
    assert.equal(calls.length, 2);
  });
});
