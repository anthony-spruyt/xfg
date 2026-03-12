import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { validateRuleset } from "../../../src/config/validators/ruleset-validator.js";

describe("validateRuleset", () => {
  test("accepts valid ruleset", () => {
    assert.doesNotThrow(() =>
      validateRuleset(
        {
          target: "branch",
          enforcement: "active",
          rules: [{ type: "pull_request" }],
        },
        "test-ruleset",
        "ctx"
      )
    );
  });

  test("accepts empty object", () => {
    assert.doesNotThrow(() => validateRuleset({}, "test", "ctx"));
  });

  test("rejects non-object input", () => {
    assert.throws(
      () => validateRuleset("string", "test", "ctx"),
      /must be an object/
    );
    assert.throws(
      () => validateRuleset(null, "test", "ctx"),
      /must be an object/
    );
  });

  test("rejects invalid target", () => {
    assert.throws(
      () => validateRuleset({ target: "invalid" }, "test", "ctx"),
      /target must be one of/
    );
  });

  test("rejects invalid enforcement", () => {
    assert.throws(
      () => validateRuleset({ enforcement: "invalid" }, "test", "ctx"),
      /enforcement must be one of/
    );
  });

  test("rejects non-array bypassActors", () => {
    assert.throws(
      () => validateRuleset({ bypassActors: "invalid" }, "test", "ctx"),
      /bypassActors must be an array/
    );
  });

  test("validates bypassActor fields", () => {
    assert.throws(
      () =>
        validateRuleset(
          { bypassActors: [{ actorId: "not-a-number", actorType: "Team" }] },
          "test",
          "ctx"
        ),
      /actorId must be a number/
    );
    assert.throws(
      () =>
        validateRuleset(
          { bypassActors: [{ actorId: 1, actorType: "Invalid" }] },
          "test",
          "ctx"
        ),
      /actorType must be one of/
    );
  });

  test("validates rules array", () => {
    assert.throws(
      () => validateRuleset({ rules: "not-array" }, "test", "ctx"),
      /rules must be an array/
    );
  });

  test("rejects invalid rule type", () => {
    assert.throws(
      () =>
        validateRuleset({ rules: [{ type: "nonexistent" }] }, "test", "ctx"),
      /invalid rule type/
    );
  });

  test("validates pull_request rule parameters", () => {
    assert.doesNotThrow(() =>
      validateRuleset(
        {
          rules: [
            {
              type: "pull_request",
              parameters: {
                requiredApprovingReviewCount: 2,
                allowedMergeMethods: ["squash", "merge"],
              },
            },
          ],
        },
        "test",
        "ctx"
      )
    );
  });

  test("rejects invalid requiredApprovingReviewCount", () => {
    assert.throws(
      () =>
        validateRuleset(
          {
            rules: [
              {
                type: "pull_request",
                parameters: { requiredApprovingReviewCount: 99 },
              },
            ],
          },
          "test",
          "ctx"
        ),
      /requiredApprovingReviewCount must be an integer between 0 and 10/
    );
  });

  test("validates conditions.refName", () => {
    assert.doesNotThrow(() =>
      validateRuleset(
        {
          conditions: {
            refName: { include: ["refs/heads/main"], exclude: [] },
          },
        },
        "test",
        "ctx"
      )
    );
  });

  test("rejects non-string array in conditions.refName.include", () => {
    assert.throws(
      () =>
        validateRuleset(
          { conditions: { refName: { include: [42] } } },
          "test",
          "ctx"
        ),
      /include must be an array of strings/
    );
  });
});
