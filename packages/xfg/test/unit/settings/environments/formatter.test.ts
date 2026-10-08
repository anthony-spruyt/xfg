import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { formatEnvironmentsPlan } from "../../../../src/settings/environments/formatter.js";
import type { EnvironmentChange } from "../../../../src/settings/environments/diff.js";

const strip = (s: string) =>
  s.replace(new RegExp(String.fromCharCode(0x1b) + "\\[[0-9;]*m", "g"), "");

const change = (overrides: Partial<EnvironmentChange>): EnvironmentChange => ({
  action: "unchanged",
  name: "release",
  desiredKind: "all",
  putPolicy: false,
  missingPatterns: [],
  unmanagedPatterns: [],
  patternsKnown: true,
  ...overrides,
});

describe("formatEnvironmentsPlan", () => {
  test("returns nothing when every environment is unchanged", () => {
    const result = formatEnvironmentsPlan([change({})], true);
    assert.deepEqual(result, { lines: [], entries: [] });
  });

  test("shows a created environment with its policy and patterns", () => {
    const result = formatEnvironmentsPlan(
      [
        change({
          action: "create",
          desiredKind: "custom",
          putPolicy: true,
          missingPatterns: [
            { type: "branch", name: "main" },
            { type: "tag", name: "v*" },
          ],
        }),
      ],
      true
    );
    assert.deepEqual(result.lines.map(strip), [
      '    + environment "release"',
      "        deployment branches: custom",
      '        + branch "main"',
      '        + tag "v*"',
      "  Plan: 1 environment (1 to create)",
    ]);
    assert.deepEqual(result.entries, [
      {
        name: "release",
        action: "create",
        desiredKind: "custom",
        addedPatterns: [
          { type: "branch", name: "main" },
          { type: "tag", name: "v*" },
        ],
      },
    ]);
  });

  test("shows a policy change on an existing environment", () => {
    const result = formatEnvironmentsPlan(
      [
        change({
          action: "update",
          name: "prod",
          currentKind: "all",
          desiredKind: "protected",
          putPolicy: true,
        }),
      ],
      false
    );
    assert.deepEqual(result.lines.map(strip), [
      '    ~ environment "prod"',
      "        deployment branches: all → protected",
      "  Applied: 1 environment (1 updated)",
    ]);
    assert.deepEqual(result.entries, [
      {
        name: "prod",
        action: "update",
        currentKind: "all",
        desiredKind: "protected",
        addedPatterns: [],
      },
    ]);
  });

  test("shows only added patterns when the policy kind is unchanged", () => {
    const result = formatEnvironmentsPlan(
      [
        change({
          action: "update",
          currentKind: "custom",
          desiredKind: "custom",
          missingPatterns: [{ type: "tag", name: "v*" }],
        }),
        change({ name: "preview", action: "create" }),
      ],
      true
    );
    assert.deepEqual(result.lines.map(strip), [
      '    + environment "preview"',
      "        deployment branches: all",
      '    ~ environment "release"',
      '        + tag "v*"',
      "  Plan: 2 environments (1 to create, 1 to update)",
    ]);
  });
});
