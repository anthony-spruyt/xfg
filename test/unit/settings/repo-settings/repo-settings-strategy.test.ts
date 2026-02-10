import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import {
  isRepoSettingsStrategy,
  type IRepoSettingsStrategy,
} from "../../../../src/settings/repo-settings/types.js";

describe("IRepoSettingsStrategy interface", () => {
  test("should define required methods", () => {
    // Type-level test - if this compiles, the interface is correct
    const mockStrategy: IRepoSettingsStrategy = {
      getSettings: async () => ({}),
      updateSettings: async () => {},
      setVulnerabilityAlerts: async () => {},
      setAutomatedSecurityFixes: async () => {},
      setPrivateVulnerabilityReporting: async () => {},
    };
    assert.ok(mockStrategy.getSettings);
    assert.ok(mockStrategy.updateSettings);
    assert.ok(mockStrategy.setVulnerabilityAlerts);
    assert.ok(mockStrategy.setAutomatedSecurityFixes);
    assert.ok(mockStrategy.setPrivateVulnerabilityReporting);
  });
});

describe("isRepoSettingsStrategy", () => {
  test("should return true for valid strategy", () => {
    const mockStrategy = {
      getSettings: async () => ({}),
      updateSettings: async () => {},
      setVulnerabilityAlerts: async () => {},
      setAutomatedSecurityFixes: async () => {},
      setPrivateVulnerabilityReporting: async () => {},
    };
    assert.equal(isRepoSettingsStrategy(mockStrategy), true);
  });

  test("should return false for null", () => {
    assert.equal(isRepoSettingsStrategy(null), false);
  });

  test("should return false for non-object", () => {
    assert.equal(isRepoSettingsStrategy("string"), false);
    assert.equal(isRepoSettingsStrategy(123), false);
    assert.equal(isRepoSettingsStrategy(undefined), false);
  });

  test("should return false for object missing methods", () => {
    assert.equal(isRepoSettingsStrategy({}), false);
    assert.equal(
      isRepoSettingsStrategy({ getSettings: async () => ({}) }),
      false
    );
    assert.equal(
      isRepoSettingsStrategy({
        getSettings: async () => ({}),
        updateSettings: async () => {},
      }),
      false
    );
    assert.equal(
      isRepoSettingsStrategy({
        getSettings: async () => ({}),
        updateSettings: async () => {},
        setVulnerabilityAlerts: async () => {},
      }),
      false
    );
    assert.equal(
      isRepoSettingsStrategy({
        getSettings: async () => ({}),
        updateSettings: async () => {},
        setVulnerabilityAlerts: async () => {},
        setAutomatedSecurityFixes: async () => {},
      }),
      false
    );
  });

  test("should return false for object with non-function properties", () => {
    assert.equal(
      isRepoSettingsStrategy({
        getSettings: "not a function",
        updateSettings: async () => {},
        setVulnerabilityAlerts: async () => {},
        setAutomatedSecurityFixes: async () => {},
        setPrivateVulnerabilityReporting: async () => {},
      }),
      false
    );
  });
});
