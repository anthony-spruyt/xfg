import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import {
  ACTIONS_ENDPOINTS,
  buildPayload,
  endpointByName,
  readEndpoint,
} from "../../../../src/settings/actions/endpoints.js";

describe("ACTIONS_ENDPOINTS", () => {
  test("lists permissions before selected-actions", () => {
    const names = ACTIONS_ENDPOINTS.map((e) => e.name);
    assert.ok(names.indexOf("permissions") < names.indexOf("selectedActions"));
  });

  test("maps every config field to exactly one endpoint", () => {
    const settings = ACTIONS_ENDPOINTS.flatMap((e) =>
      e.fields.map((f) => f.setting)
    );
    assert.equal(new Set(settings).size, settings.length);
    assert.equal(settings.length, 12);
  });
});

describe("readEndpoint", () => {
  test("renames API fields to config fields", () => {
    const result = readEndpoint(endpointByName("workflow"), {
      default_workflow_permissions: "read",
      can_approve_pull_request_reviews: false,
    });
    assert.deepStrictEqual(result, {
      defaultWorkflowPermissions: "read",
      canApprovePullRequestReviews: false,
    });
  });

  test("ignores API fields xfg does not manage", () => {
    const result = readEndpoint(endpointByName("permissions"), {
      enabled: true,
      allowed_actions: "selected",
      selected_actions_url: "https://api.github.com/x",
      sha_pinning_required: true,
    });
    assert.deepStrictEqual(result, {
      enabled: true,
      allowedActions: "selected",
      shaPinningRequired: true,
    });
  });

  test("leaves out fields the response omits", () => {
    const result = readEndpoint(endpointByName("permissions"), {
      enabled: false,
      sha_pinning_required: false,
    });
    assert.deepStrictEqual(result, {
      enabled: false,
      shaPinningRequired: false,
    });
  });
});

describe("buildPayload", () => {
  test("permissions always sends enabled and echoes the current values not configured", () => {
    const payload = buildPayload(
      endpointByName("permissions"),
      { shaPinningRequired: true },
      { enabled: true, allowedActions: "selected", shaPinningRequired: false }
    );
    assert.deepStrictEqual(payload, {
      enabled: true,
      allowed_actions: "selected",
      sha_pinning_required: true,
    });
  });

  test("configured values win over current ones", () => {
    const payload = buildPayload(
      endpointByName("permissions"),
      { enabled: true, allowedActions: "all" },
      { enabled: false, allowedActions: "selected", shaPinningRequired: true }
    );
    assert.deepStrictEqual(payload, {
      enabled: true,
      allowed_actions: "all",
      sha_pinning_required: true,
    });
  });

  test("permissions does not echo values when Actions is disabled", () => {
    const payload = buildPayload(
      endpointByName("permissions"),
      { enabled: false },
      { enabled: true, allowedActions: "all", shaPinningRequired: true }
    );
    assert.deepStrictEqual(payload, { enabled: false });
  });

  test("permissions sends only enabled while the current state is disabled", () => {
    const payload = buildPayload(
      endpointByName("permissions"),
      { shaPinningRequired: true },
      { enabled: false, shaPinningRequired: false }
    );
    assert.deepStrictEqual(payload, { enabled: false });
  });

  test("selected-actions echoes the other current fields", () => {
    const payload = buildPayload(
      endpointByName("selectedActions"),
      { patternsAllowed: ["a/b@*"] },
      {
        githubOwnedAllowed: true,
        verifiedAllowed: false,
        patternsAllowed: ["old/x@*"],
      }
    );
    assert.deepStrictEqual(payload, {
      github_owned_allowed: true,
      verified_allowed: false,
      patterns_allowed: ["a/b@*"],
    });
  });

  test("selected-actions sends only configured fields when nothing is current", () => {
    const payload = buildPayload(
      endpointByName("selectedActions"),
      { patternsAllowed: ["a/b@*"] },
      {}
    );
    assert.deepStrictEqual(payload, { patterns_allowed: ["a/b@*"] });
  });

  test("single-field endpoints send the configured value", () => {
    assert.deepStrictEqual(
      buildPayload(
        endpointByName("artifactRetention"),
        { artifactAndLogRetentionDays: 30 },
        {}
      ),
      { days: 30 }
    );
    assert.deepStrictEqual(
      buildPayload(
        endpointByName("cacheRetention"),
        { cacheRetentionDays: 7 },
        {}
      ),
      { max_cache_retention_days: 7 }
    );
    assert.deepStrictEqual(
      buildPayload(endpointByName("cacheStorage"), { cacheSizeGb: 10 }, {}),
      { max_cache_size_gb: 10 }
    );
    assert.deepStrictEqual(
      buildPayload(
        endpointByName("forkPrApproval"),
        { forkPrApprovalPolicy: "first_time_contributors" },
        {}
      ),
      { approval_policy: "first_time_contributors" }
    );
  });
});
