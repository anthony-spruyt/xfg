import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { formatRepoSettingsPlan } from "../../../../src/settings/repo-settings/formatter.js";
import type { RepoSettingsChange } from "../../../../src/settings/repo-settings/diff.js";

describe("formatRepoSettingsPlan", () => {
  test("entries include oldValue and newValue for change action", () => {
    const changes: RepoSettingsChange[] = [
      {
        property: "deleteBranchOnMerge",
        action: "update",
        oldValue: false,
        newValue: true,
      },
    ];

    const result = formatRepoSettingsPlan(changes);

    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].property, "deleteBranchOnMerge");
    assert.equal(result.entries[0].action, "update");
    assert.equal(result.entries[0].oldValue, false);
    assert.equal(result.entries[0].newValue, true);
  });

  test("entries include newValue for add action", () => {
    const changes: RepoSettingsChange[] = [
      {
        property: "hasWiki",
        action: "create",
        newValue: true,
      },
    ];

    const result = formatRepoSettingsPlan(changes);

    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].action, "create");
    assert.equal(result.entries[0].newValue, true);
    assert.equal(result.entries[0].oldValue, undefined);
  });
});
