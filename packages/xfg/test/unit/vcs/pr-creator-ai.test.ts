import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import {
  formatPRBody,
  createPR,
  type FileAction,
} from "../../../src/vcs/pr-creator.js";
import type { IPRStrategy, PRStrategyOptions } from "../../../src/vcs/types.js";
import type { GitHubRepoInfo } from "../../../src/repo/index.js";

const repoInfo: GitHubRepoInfo = {
  type: "github",
  gitUrl: "git@github.com:test-org/test-repo.git",
  owner: "test-org",
  repo: "test-repo",
  host: "github.com",
};

const files: FileAction[] = [{ fileName: "ci.yaml", action: "update" }];
const SUMMARY = "Pins actions/checkout to v5.";

function capturingStrategy(): {
  strategy: IPRStrategy;
  created: PRStrategyOptions[];
} {
  const created: PRStrategyOptions[] = [];
  return {
    created,
    strategy: {
      async findExistingPRUrl() {
        return null;
      },
      async closeExistingPR() {
        return { status: "no_pr" as const };
      },
      async create(options) {
        created.push(options);
        return { success: true, message: "ok", url: "https://x/pull/1" };
      },
      async merge() {
        return { success: true, message: "" };
      },
    },
  };
}

describe("formatPRBody pr.aiSummary", () => {
  test("default template places the AI summary under Summary", () => {
    const body = formatPRBody(files, repoInfo, undefined, SUMMARY);
    const summaryIdx = body.indexOf("## Summary");
    const aiIdx = body.indexOf(SUMMARY);
    const changesIdx = body.indexOf("## Changes");
    assert.ok(summaryIdx >= 0 && aiIdx > summaryIdx && aiIdx < changesIdx);
  });

  test("default template without AI summary has no leftover placeholder", () => {
    const body = formatPRBody(files, repoInfo);
    assert.ok(!body.includes("aiSummary"));
    assert.ok(!body.includes("\n\n\n\n"));
  });

  test("custom template can place ${xfg:pr.aiSummary}", () => {
    const body = formatPRBody(
      files,
      repoInfo,
      "Top\n\n${xfg:pr.aiSummary}\n\nBottom",
      SUMMARY
    );
    assert.equal(body, `Top\n\n${SUMMARY}\n\nBottom`);
  });

  test("custom template without the var gets the summary appended", () => {
    const body = formatPRBody(files, repoInfo, "Custom body", SUMMARY);
    assert.ok(body.startsWith("Custom body"));
    assert.ok(body.includes("## AI Summary"));
    assert.ok(body.trimEnd().endsWith(SUMMARY));
  });

  test("an escaped placeholder does not count as using the var", () => {
    const body = formatPRBody(
      files,
      repoInfo,
      "Docs: $${xfg:pr.aiSummary}",
      SUMMARY
    );
    assert.ok(body.startsWith("Docs: ${xfg:pr.aiSummary}"));
    assert.ok(body.trimEnd().endsWith(SUMMARY));
  });

  test("custom template without the var and no summary is unchanged", () => {
    assert.equal(formatPRBody(files, repoInfo, "Custom body"), "Custom body");
  });

  test("dropping the placeholder keeps adjacent lines apart", () => {
    const cases: Array<[string, string]> = [
      ["## A\n${xfg:pr.aiSummary}\n## B", "## A\n## B"],
      ["A\n\n${xfg:pr.aiSummary}\n\nB", "A\n\nB"],
      ["A\n\n${xfg:pr.aiSummary}\nB", "A\n\nB"],
      ["A\n${xfg:pr.aiSummary}\n\nB", "A\n\nB"],
      ["${xfg:pr.aiSummary}\n\nB", "B"],
    ];
    for (const [template, expected] of cases) {
      assert.equal(formatPRBody(files, repoInfo, template), expected);
    }
  });

  test("pr.aiSummary is empty when AI is off", () => {
    assert.equal(formatPRBody(files, repoInfo, "[${xfg:pr.aiSummary}]"), "[]");
  });

  test("pr.title uses the override title", () => {
    const body = formatPRBody(
      files,
      repoInfo,
      "${xfg:pr.title}",
      undefined,
      "ci: pin checkout"
    );
    assert.equal(body, "ci: pin checkout");
  });
});

describe("createPR with AI title and summary", () => {
  test("uses the given title and summary", async () => {
    const { strategy, created } = capturingStrategy();
    await createPR({
      repoInfo,
      branchName: "chore/sync-config",
      baseBranch: "main",
      files,
      workDir: "/tmp/x",
      executor: { exec: async () => "" },
      strategy,
      title: "ci(workflows): pin checkout to v5",
      aiSummary: SUMMARY,
    });
    assert.equal(created[0].title, "ci(workflows): pin checkout to v5");
    assert.ok(created[0].body.includes(SUMMARY));
  });

  test("falls back to the default title", async () => {
    const { strategy, created } = capturingStrategy();
    await createPR({
      repoInfo,
      branchName: "chore/sync-config",
      baseBranch: "main",
      files,
      workDir: "/tmp/x",
      executor: { exec: async () => "" },
      strategy,
    });
    assert.equal(created[0].title, "chore: sync ci.yaml");
  });

  test("dry run message shows the AI title", async () => {
    const result = await createPR({
      repoInfo,
      branchName: "b",
      baseBranch: "main",
      files,
      workDir: "/tmp/x",
      dryRun: true,
      executor: { exec: async () => "" },
      title: "ci: x",
    });
    assert.match(result.message, /"ci: x"/);
  });
});
