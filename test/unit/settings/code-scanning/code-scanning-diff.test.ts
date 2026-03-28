import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import {
  diffCodeScanning,
  hasCodeScanningChanges,
} from "../../../../src/settings/code-scanning/diff.js";
import type { CurrentCodeScanningSettings } from "../../../../src/settings/code-scanning/types.js";
import type { CodeScanningSettings } from "../../../../src/config/index.js";

describe("diffCodeScanning", () => {
  test("detects state change", () => {
    const current: CurrentCodeScanningSettings = {
      state: "not-configured",
    };
    const desired: CodeScanningSettings = { state: "configured" };

    const changes = diffCodeScanning(current, desired);
    const stateChange = changes.find((c) => c.property === "state");

    assert.ok(stateChange);
    assert.equal(stateChange.action, "update");
    assert.equal(stateChange.oldValue, "not-configured");
    assert.equal(stateChange.newValue, "configured");
  });

  test("detects querySuite change", () => {
    const current: CurrentCodeScanningSettings = {
      state: "configured",
      query_suite: "default",
    };
    const desired: CodeScanningSettings = {
      state: "configured",
      querySuite: "extended",
    };

    const changes = diffCodeScanning(current, desired);
    const qsChange = changes.find((c) => c.property === "querySuite");

    assert.ok(qsChange);
    assert.equal(qsChange.action, "update");
    assert.equal(qsChange.oldValue, "default");
    assert.equal(qsChange.newValue, "extended");
  });

  test("detects languages change (sorted comparison)", () => {
    const current: CurrentCodeScanningSettings = {
      state: "configured",
      languages: ["python", "javascript-typescript"],
    };
    const desired: CodeScanningSettings = {
      state: "configured",
      languages: ["go", "python"],
    };

    const changes = diffCodeScanning(current, desired);
    const langChange = changes.find((c) => c.property === "languages");

    assert.ok(langChange);
    assert.equal(langChange.action, "update");
  });

  test("no changes when everything matches", () => {
    const current: CurrentCodeScanningSettings = {
      state: "configured",
      query_suite: "default",
      languages: ["javascript-typescript", "python"],
    };
    const desired: CodeScanningSettings = {
      state: "configured",
      querySuite: "default",
      languages: ["python", "javascript-typescript"],
    };

    const changes = diffCodeScanning(current, desired);

    assert.ok(!hasCodeScanningChanges(changes));
  });

  test("skips querySuite diff when not specified in desired", () => {
    const current: CurrentCodeScanningSettings = {
      state: "configured",
      query_suite: "default",
    };
    const desired: CodeScanningSettings = { state: "configured" };

    const changes = diffCodeScanning(current, desired);

    assert.ok(!changes.find((c) => c.property === "querySuite"));
  });

  test("skips languages diff when not specified in desired", () => {
    const current: CurrentCodeScanningSettings = {
      state: "configured",
      languages: ["python"],
    };
    const desired: CodeScanningSettings = { state: "configured" };

    const changes = diffCodeScanning(current, desired);

    assert.ok(!changes.find((c) => c.property === "languages"));
  });

  test("uses create action when querySuite is new", () => {
    const current: CurrentCodeScanningSettings = {
      state: "configured",
    };
    const desired: CodeScanningSettings = {
      state: "configured",
      querySuite: "extended",
    };

    const changes = diffCodeScanning(current, desired);
    const qsChange = changes.find((c) => c.property === "querySuite");

    assert.ok(qsChange);
    assert.equal(qsChange.action, "create");
    assert.equal(qsChange.oldValue, undefined);
    assert.equal(qsChange.newValue, "extended");
  });

  test("uses create action when languages is new", () => {
    const current: CurrentCodeScanningSettings = {
      state: "configured",
    };
    const desired: CodeScanningSettings = {
      state: "configured",
      languages: ["python"],
    };

    const changes = diffCodeScanning(current, desired);
    const langChange = changes.find((c) => c.property === "languages");

    assert.ok(langChange);
    assert.equal(langChange.action, "create");
    assert.equal(langChange.oldValue, undefined);
    assert.deepStrictEqual(langChange.newValue, ["python"]);
  });

  test("hasCodeScanningChanges returns true when changes exist", () => {
    const current: CurrentCodeScanningSettings = {
      state: "not-configured",
    };
    const desired: CodeScanningSettings = { state: "configured" };

    const changes = diffCodeScanning(current, desired);

    assert.ok(hasCodeScanningChanges(changes));
  });
});
