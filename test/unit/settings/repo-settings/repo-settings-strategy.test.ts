import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import type { IRepoSettingsStrategy } from "../../../../src/settings/repo-settings/types.js";

describe("IRepoSettingsStrategy interface", () => {
  test("should define required methods", () => {
    // Type-level test - if this compiles, the interface is correct
    const mockStrategy: IRepoSettingsStrategy = {
      get: async () => ({}),
      update: async () => {},
      updateVulnerabilityAlerts: async () => {},
      updateAutomatedSecurityFixes: async () => {},
      updatePrivateVulnerabilityReporting: async () => {},
      branchExists: async () => true,
    };
    assert.ok(mockStrategy.get);
    assert.ok(mockStrategy.update);
    assert.ok(mockStrategy.updateVulnerabilityAlerts);
    assert.ok(mockStrategy.updateAutomatedSecurityFixes);
    assert.ok(mockStrategy.updatePrivateVulnerabilityReporting);
    assert.ok(mockStrategy.branchExists);
  });
});
