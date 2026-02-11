import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { formatRulesetPlan } from "../../src/settings/rulesets/formatter.js";
import type { RulesetChange } from "../../src/settings/rulesets/diff.js";

describe("formatRulesetPlan propertyDiffs", () => {
  test("entries include propertyDiffs for update action", () => {
    const changes: RulesetChange[] = [
      {
        name: "branch-protection",
        action: "update",
        current: {
          name: "branch-protection",
          enforcement: "active",
          target: "branch",
        },
        desired: {
          name: "branch-protection",
          enforcement: "evaluate",
          target: "branch",
        },
      },
    ];

    const result = formatRulesetPlan(changes);

    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].action, "update");
    assert.ok(result.entries[0].propertyDiffs);
    assert.ok(result.entries[0].propertyDiffs!.length > 0);
    const enforcementDiff = result.entries[0].propertyDiffs!.find(
      (d) => d.path[0] === "enforcement"
    );
    assert.ok(enforcementDiff);
    assert.equal(enforcementDiff!.oldValue, "active");
    assert.equal(enforcementDiff!.newValue, "evaluate");
  });

  test("entries include config for create action", () => {
    const changes: RulesetChange[] = [
      {
        name: "new-ruleset",
        action: "create",
        desired: {
          name: "new-ruleset",
          enforcement: "active",
          target: "branch",
        },
      },
    ];

    const result = formatRulesetPlan(changes);

    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].action, "create");
    assert.ok(result.entries[0].config);
    assert.equal(result.entries[0].config!.name, "new-ruleset");
  });
});
