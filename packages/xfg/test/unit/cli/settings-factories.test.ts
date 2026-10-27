import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { createDefaultFactories } from "../../../src/cli/settings-factories.js";
import {
  RulesetProcessor,
  RepoSettingsProcessor,
  LabelsProcessor,
  CodeScanningProcessor,
  VariablesProcessor,
  CollaboratorsProcessor,
  EnvironmentsProcessor,
} from "../../../src/settings/index.js";
import type { ProcessExecutor } from "../../../src/shared/command-executor.js";
import type { SettingsProcessorFactories } from "../../../src/cli/types.js";

const stubExecutor = {
  exec: async () => "",
} as unknown as ProcessExecutor;

describe("createDefaultFactories", () => {
  test("with partial override uses the provided factory for overridden key", () => {
    const customRulesets = (() => ({
      process: async () => ({}),
    })) as unknown as SettingsProcessorFactories["rulesets"];
    const factories = createDefaultFactories(stubExecutor, {
      rulesets: customRulesets,
    });
    assert.equal(factories.rulesets, customRulesets);
  });

  test("with no overrides builds each key's own processor", () => {
    const factories = createDefaultFactories(stubExecutor);

    assert.ok(factories.rulesets() instanceof RulesetProcessor);
    assert.ok(factories.labels() instanceof LabelsProcessor);
    assert.ok(factories.repo() instanceof RepoSettingsProcessor);
    assert.ok(factories.codeScanning() instanceof CodeScanningProcessor);
    assert.ok(factories.variables() instanceof VariablesProcessor);
    assert.ok(factories.collaborators() instanceof CollaboratorsProcessor);
    assert.ok(factories.environments() instanceof EnvironmentsProcessor);
  });

  test("with all overrides uses all provided factories", () => {
    const stub = () => ({ process: async () => ({}) });
    const overrides = {
      rulesets: stub,
      labels: stub,
      repo: stub,
      codeScanning: stub,
    } as unknown as SettingsProcessorFactories;

    const factories = createDefaultFactories(stubExecutor, overrides);

    assert.equal(factories.rulesets, overrides.rulesets);
    assert.equal(factories.labels, overrides.labels);
    assert.equal(factories.repo, overrides.repo);
    assert.equal(factories.codeScanning, overrides.codeScanning);
  });
});
