import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import {
  createDefaultRulesetProcessorFactory,
  createDefaultRepoSettingsProcessorFactory,
  createDefaultLabelsProcessorFactory,
  createDefaultCodeScanningProcessorFactory,
  createDefaultFactories,
} from "../../../src/cli/settings-factories.js";
import type { ProcessExecutor } from "../../../src/shared/command-executor.js";
import type { SettingsProcessorFactories } from "../../../src/cli/types.js";

const stubExecutor = {
  exec: async () => "",
} as unknown as ProcessExecutor;

describe("createDefaultRulesetProcessorFactory", () => {
  test("returns a function", () => {
    const factory = createDefaultRulesetProcessorFactory(stubExecutor);
    assert.equal(typeof factory, "function");
  });

  test("factory produces a processor with a process method", () => {
    const factory = createDefaultRulesetProcessorFactory(stubExecutor);
    const processor = factory();
    assert.equal(typeof processor.process, "function");
  });
});

describe("createDefaultRepoSettingsProcessorFactory", () => {
  test("returns a function", () => {
    const factory = createDefaultRepoSettingsProcessorFactory(stubExecutor);
    assert.equal(typeof factory, "function");
  });

  test("factory produces a processor with a process method", () => {
    const factory = createDefaultRepoSettingsProcessorFactory(stubExecutor);
    const processor = factory();
    assert.equal(typeof processor.process, "function");
  });
});

describe("createDefaultLabelsProcessorFactory", () => {
  test("returns a function", () => {
    const factory = createDefaultLabelsProcessorFactory(stubExecutor);
    assert.equal(typeof factory, "function");
  });

  test("factory produces a processor with a process method", () => {
    const factory = createDefaultLabelsProcessorFactory(stubExecutor);
    const processor = factory();
    assert.equal(typeof processor.process, "function");
  });
});

describe("createDefaultCodeScanningProcessorFactory", () => {
  test("returns a function", () => {
    const factory = createDefaultCodeScanningProcessorFactory(stubExecutor);
    assert.equal(typeof factory, "function");
  });

  test("factory produces a processor with a process method", () => {
    const factory = createDefaultCodeScanningProcessorFactory(stubExecutor);
    const processor = factory();
    assert.equal(typeof processor.process, "function");
  });
});

describe("createDefaultFactories", () => {
  test("with no overrides returns all 4 keys", () => {
    const factories = createDefaultFactories(stubExecutor);
    assert.ok("rulesets" in factories);
    assert.ok("labels" in factories);
    assert.ok("repo" in factories);
    assert.ok("codeScanning" in factories);
  });

  test("with no overrides each factory is a function", () => {
    const factories = createDefaultFactories(stubExecutor);
    assert.equal(typeof factories.rulesets, "function");
    assert.equal(typeof factories.labels, "function");
    assert.equal(typeof factories.repo, "function");
    assert.equal(typeof factories.codeScanning, "function");
  });

  test("with no overrides each factory produces a processor with a process method", () => {
    const factories = createDefaultFactories(stubExecutor);
    assert.equal(typeof factories.rulesets().process, "function");
    assert.equal(typeof factories.labels().process, "function");
    assert.equal(typeof factories.repo().process, "function");
    assert.equal(typeof factories.codeScanning().process, "function");
  });

  test("with partial override uses the provided factory for overridden key", () => {
    const customRulesets = (() => ({
      process: async () => ({}),
    })) as unknown as SettingsProcessorFactories["rulesets"];
    const factories = createDefaultFactories(stubExecutor, {
      rulesets: customRulesets,
    });
    assert.equal(factories.rulesets, customRulesets);
  });

  test("with partial override uses defaults for non-overridden keys", () => {
    const customRulesets = (() => ({
      process: async () => ({}),
    })) as unknown as SettingsProcessorFactories["rulesets"];
    const factories = createDefaultFactories(stubExecutor, {
      rulesets: customRulesets,
    });
    assert.equal(typeof factories.labels, "function");
    assert.equal(typeof factories.repo, "function");
    assert.equal(typeof factories.codeScanning, "function");
    assert.equal(typeof factories.labels().process, "function");
    assert.equal(typeof factories.repo().process, "function");
    assert.equal(typeof factories.codeScanning().process, "function");
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
