import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import {
  validateRawConfig,
  hasActionableSettings,
} from "../../../src/config/validator.js";
import type { RawConfig, RawRepoSettings } from "../../../src/config/types.js";

const append = (...values: unknown[]) => ({
  $arrayMerge: "append",
  $values: values,
});

function config(extra: Record<string, unknown>): RawConfig {
  return {
    id: "test",
    files: { "a.json": { content: { a: 1 } } },
    repos: [{ git: "https://github.com/org/repo.git" }],
    ...extra,
  } as unknown as RawConfig;
}

function accepts(extra: Record<string, unknown>): void {
  assert.doesNotThrow(() => validateRawConfig(config(extra)));
}

function rejects(extra: Record<string, unknown>, message: RegExp): void {
  assert.throws(() => validateRawConfig(config(extra)), message);
}

describe("raw validation of array directives", () => {
  describe("codeScanning.languages", () => {
    const settings = (languages: unknown) => ({
      settings: { codeScanning: { state: "configured", languages } },
    });

    test("accepts a directive", () => {
      accepts(settings(append("go")));
    });

    test("checks the items inside a directive", () => {
      rejects(settings(append("rust")), /invalid language "rust"/);
    });

    test("rejects a value that is neither an array nor a directive", () => {
      rejects(settings("go"), /languages must be an array or \$arrayMerge/);
    });
  });

  describe("collaborators.users", () => {
    const settings = (users: unknown) => ({
      settings: { collaborators: { users } },
    });

    test("accepts a directive", () => {
      accepts(settings(append("octocat")));
    });

    test("checks the usernames inside a directive", () => {
      rejects(settings(append("not valid!")), /collaborators\.users/);
    });

    test("rejects a value that is neither an array nor a directive", () => {
      rejects(settings("octocat"), /users must be an array.*\$arrayMerge/);
    });

    test("a directive of users is actionable", () => {
      const raw = { collaborators: { users: append("octocat") } };
      assert.equal(
        hasActionableSettings(raw as unknown as RawRepoSettings),
        true
      );
    });

    test("a directive of no users is not actionable", () => {
      const raw = { collaborators: { users: append() } };
      assert.equal(
        hasActionableSettings(raw as unknown as RawRepoSettings),
        false
      );
    });
  });

  describe("actions.patternsAllowed", () => {
    const settings = (patternsAllowed: unknown) => ({
      settings: {
        actions: { allowedActions: "selected", patternsAllowed },
      },
    });

    test("accepts a directive", () => {
      accepts(settings(append("docker/login-action@*")));
    });

    test("checks the patterns inside a directive", () => {
      rejects(settings(append(" ")), /patternsAllowed\[0\]/);
    });

    test("rejects a value that is neither an array nor a directive", () => {
      rejects(
        settings("a@*"),
        /patternsAllowed must be an array.*\$arrayMerge/
      );
    });

    test("names the group that holds the mistake", () => {
      rejects(
        {
          groups: {
            g: { settings: { actions: { patternsAllowed: append(1) } } },
          },
        },
        /groups\.g actions: patternsAllowed\[0\]/
      );
    });
  });

  describe("deploymentBranchPolicy.custom", () => {
    const settings = (custom: unknown) => ({
      settings: {
        environments: { prod: { deploymentBranchPolicy: { custom } } },
      },
    });
    const branch = { type: "branch", name: "release/*" };

    test("accepts append", () => {
      accepts(settings(append(branch)));
    });

    test("accepts merge with $matchBy", () => {
      accepts(
        settings({
          $arrayMerge: "merge",
          $matchBy: "name",
          $values: [branch],
        })
      );
    });

    test("rejects merge without $matchBy", () => {
      rejects(
        settings({ $arrayMerge: "merge", $values: [branch] }),
        /custom with \$arrayMerge: merge needs \$matchBy/
      );
    });

    test("checks the patterns inside a directive", () => {
      rejects(settings(append({ type: "branch" })), /custom\[0\]/);
    });

    test("rejects a directive with no patterns", () => {
      rejects(
        settings({ $arrayMerge: "replace", $values: [] }),
        /custom must be a non-empty array/
      );
    });
  });

  describe("ruleset rule parameters", () => {
    const ruleset = (rule: unknown) => ({
      settings: {
        rulesets: { main: { rules: [rule] } },
      },
    });

    test("accepts a directive for allowedMergeMethods", () => {
      accepts(
        ruleset({
          type: "pull_request",
          parameters: { allowedMergeMethods: append("squash") },
        })
      );
    });

    test("checks the merge methods inside a directive", () => {
      rejects(
        ruleset({
          type: "pull_request",
          parameters: { allowedMergeMethods: append("fast-forward") },
        }),
        /allowedMergeMethods values must be one of/
      );
    });

    test("accepts a directive for filePatterns of a required reviewer", () => {
      accepts(
        ruleset({
          type: "pull_request",
          parameters: {
            requiredReviewers: [
              {
                filePatterns: append("*.ts"),
                minimumApprovals: 1,
                reviewer: { id: 1, type: "Team" },
              },
            ],
          },
        })
      );
    });

    test("rejects filePatterns that is neither an array nor a directive", () => {
      rejects(
        ruleset({
          type: "pull_request",
          parameters: {
            requiredReviewers: [
              {
                filePatterns: "*.ts",
                minimumApprovals: 1,
                reviewer: { id: 1, type: "Team" },
              },
            ],
          },
        }),
        /filePatterns must be an array or \$arrayMerge directive/
      );
    });

    for (const [type, key] of [
      ["required_status_checks", "requiredStatusChecks"],
      ["required_deployments", "requiredDeploymentEnvironments"],
      ["workflows", "workflows"],
      ["file_path_restriction", "restrictedFilePaths"],
      ["file_extension_restriction", "restrictedFileExtensions"],
      ["code_scanning", "codeScanningTools"],
    ]) {
      test(`${type} ${key} rejects a value that is not an array or directive`, () => {
        rejects(
          ruleset({ type, parameters: { [key]: "x" } }),
          new RegExp(`${key} must be an array`)
        );
      });
    }

    test("accepts a directive for requiredStatusChecks", () => {
      accepts(
        ruleset({
          type: "required_status_checks",
          parameters: { requiredStatusChecks: append({ context: "ci" }) },
        })
      );
    });
  });

  describe("prOptions.labels", () => {
    test("accepts a directive at the root", () => {
      accepts({ prOptions: { labels: append("sync") } });
    });

    test("rejects a value that is neither an array nor a directive", () => {
      rejects(
        { prOptions: { labels: "sync" } },
        /prOptions\.labels must be an array.*\$arrayMerge/
      );
    });

    test("checks the labels inside a directive", () => {
      rejects(
        { prOptions: { labels: append("") } },
        /prOptions\.labels entries must be non-empty strings/
      );
    });

    test("checks labels of a group and names it", () => {
      rejects(
        { groups: { g: { prOptions: { labels: [""] } } } },
        /groups\.g: prOptions\.labels entries must be non-empty strings/
      );
    });

    test("checks labels of a conditional group and names it", () => {
      rejects(
        {
          groups: { g: { files: { "a.json": { content: {} } } } },
          conditionalGroups: [
            {
              when: { allOf: ["g"] },
              prOptions: { labels: append(1) },
            },
          ],
        },
        /conditionalGroups\[0\].*prOptions\.labels entries must be non-empty strings/
      );
    });

    test("checks labels of a repo and names it", () => {
      rejects(
        {
          repos: [
            {
              git: "https://github.com/org/repo.git",
              prOptions: { labels: append("") },
            },
          ],
        },
        /Repo .*: prOptions\.labels entries must be non-empty strings/
      );
    });

    test("checks the branch of a group", () => {
      rejects(
        { groups: { g: { prOptions: { branch: "bad..branch" } } } },
        /branch/i
      );
    });
  });
});
