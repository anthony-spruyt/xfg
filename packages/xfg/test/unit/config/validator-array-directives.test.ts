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

    for (const strategy of ["append", "prepend", "replace"]) {
      test(`accepts ${strategy}`, () => {
        accepts(settings({ $arrayMerge: strategy, $values: [branch] }));
      });
    }

    for (const matchBy of [undefined, "name", "type"]) {
      test(`rejects merge with $matchBy ${matchBy ?? "unset"}`, () => {
        rejects(
          settings({
            $arrayMerge: "merge",
            ...(matchBy ? { $matchBy: matchBy } : {}),
            $values: [branch],
          }),
          /custom does not accept \$arrayMerge: merge.*type and name/
        );
      });
    }

    test("names the group that holds the merge", () => {
      rejects(
        {
          groups: {
            g: {
              settings: {
                environments: {
                  prod: {
                    deploymentBranchPolicy: {
                      custom: { $arrayMerge: "merge", $values: [branch] },
                    },
                  },
                },
              },
            },
          },
        },
        /groups\.g: environment 'prod' deploymentBranchPolicy: custom does not accept/
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

  describe("$matchBy", () => {
    const bypassActors = (...ids: number[]) => ({
      $arrayMerge: "merge",
      $matchBy: "actorId",
      $values: ids.map((actorId) => ({ actorId, actorType: "Team" })),
    });
    const group = (value: unknown) => ({
      groups: {
        g: { settings: { rulesets: { main: { bypassActors: value } } } },
      },
    });

    test("accepts unique primitive values", () => {
      accepts(group(bypassActors(1, 2)));
    });

    test("rejects a repeated value, names the layer and says why", () => {
      rejects(
        group(bypassActors(1, 1)),
        /groups\.g: ruleset 'main' bypassActors must be an array or \$arrayMerge directive: \$values items 0 and 1 share \$matchBy actorId '1'/
      );
    });

    test("rejects a value that is not a string, number, boolean or null", () => {
      rejects(
        group({
          $arrayMerge: "merge",
          $matchBy: "actorId",
          $values: [{ actorId: { id: 1 }, actorType: "Team" }],
        }),
        /groups\.g: ruleset 'main' bypassActors must be an array or \$arrayMerge directive: \$values item 0 \$matchBy actorId must be a string, number, boolean or null/
      );
    });

    test("rejects an item that lacks the key", () => {
      rejects(
        group({
          $arrayMerge: "merge",
          $matchBy: "actorId",
          $values: [{ actorType: "Team" }],
        }),
        /bypassActors must be an array or \$arrayMerge directive: \$values item 0 has no \$matchBy key 'actorId'/
      );
    });

    test("gives no reason for a directive that fails for another cause", () => {
      assert.throws(
        () =>
          validateRawConfig(
            config(group({ $arrayMerge: "append", $values: "not-an-array" }))
          ),
        (error: Error) =>
          error.message.endsWith(
            "bypassActors must be an array or $arrayMerge directive"
          )
      );
    });

    const unmatchable = {
      $arrayMerge: "merge",
      $matchBy: "k",
      $values: [{ k: 1 }, { k: 1 }],
    };
    const reason = "\\$values items 0 and 1 share \\$matchBy k '1'";
    const sites: [string, Record<string, unknown>][] = [
      [
        "ruleset rules",
        { settings: { rulesets: { main: { rules: unmatchable } } } },
      ],
      [
        "conditions.refName.include",
        {
          settings: {
            rulesets: {
              main: { conditions: { refName: { include: unmatchable } } },
            },
          },
        },
      ],
      [
        "conditions.refName.exclude",
        {
          settings: {
            rulesets: {
              main: { conditions: { refName: { exclude: unmatchable } } },
            },
          },
        },
      ],
      [
        "a rule parameter",
        {
          settings: {
            rulesets: {
              main: {
                rules: [
                  {
                    type: "pull_request",
                    parameters: { allowedMergeMethods: unmatchable },
                  },
                ],
              },
            },
          },
        },
      ],
      [
        "codeScanning.languages",
        {
          settings: {
            codeScanning: { state: "configured", languages: unmatchable },
          },
        },
      ],
      [
        "collaborators.users",
        { settings: { collaborators: { users: unmatchable } } },
      ],
      [
        "actions.patternsAllowed",
        {
          settings: {
            actions: {
              allowedActions: "selected",
              patternsAllowed: unmatchable,
            },
          },
        },
      ],
      ["prOptions.labels", { prOptions: { labels: unmatchable } }],
    ];
    for (const [name, extra] of sites) {
      test(`${name} says why a directive cannot match`, () => {
        rejects(extra, new RegExp(`\\$arrayMerge directive.*: ${reason}`));
      });
    }
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
