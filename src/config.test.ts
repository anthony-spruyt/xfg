import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadConfig,
  convertContentToString,
  type RepoSettings,
  type RawRepoSettings,
  type RawConfig,
  type RawRepoConfig,
  type RepoConfig,
  type Config,
  type Ruleset,
  type RulesetRule,
  type BypassActor,
  type StatusCheckConfig,
  type CodeScanningTool,
} from "./config.js";
import { parse } from "yaml";

// Create a temporary directory for test fixtures
const testDir = join(tmpdir(), "xfg-test-" + Date.now());

function createTestConfig(content: string): string {
  const filePath = join(testDir, `config-${Date.now()}.yaml`);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

describe("Config", () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    // Set up test environment variables
    process.env.TEST_ENV_VAR = "test-value";
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    delete process.env.TEST_ENV_VAR;
  });

  describe("validation", () => {
    test("throws when files is missing", () => {
      const path = createTestConfig(`
id: test-config
repos:
  - git: git@github.com:org/repo.git
`);
      assert.throws(
        () => loadConfig(path),
        /Config missing required field: files/
      );
    });

    test("throws when repos is missing", () => {
      const path = createTestConfig(`
id: test-config
files:
  config.json:
    content:
      key: value
`);
      assert.throws(
        () => loadConfig(path),
        /Config missing required field: repos/
      );
    });

    test("throws when repos is not an array", () => {
      const path = createTestConfig(`
id: test-config
files:
  config.json:
    content:
      key: value
repos: not-an-array
`);
      assert.throws(() => loadConfig(path), /repos \(must be an array\)/);
    });

    test("throws when repo.git is missing", () => {
      const path = createTestConfig(`
id: test-config
files:
  config.json:
    content:
      key: value
repos:
  - files:
      config.json:
        content:
          extra: data
`);
      assert.throws(
        () => loadConfig(path),
        /Repo at index 0 missing required field: git/
      );
    });

    test("throws when file name contains path traversal", () => {
      const path = createTestConfig(`
id: test-config
files:
  ../escape.json:
    content:
      key: value
repos:
  - git: git@github.com:org/repo.git
`);
      assert.throws(
        () => loadConfig(path),
        /Invalid fileName.*must be a relative path/
      );
    });

    test("throws when file name is absolute path", () => {
      const path = createTestConfig(`
id: test-config
files:
  /etc/passwd:
    content:
      key: value
repos:
  - git: git@github.com:org/repo.git
`);
      assert.throws(
        () => loadConfig(path),
        /Invalid fileName.*must be a relative path/
      );
    });

    test("allows nested relative paths without traversal", () => {
      const path = createTestConfig(`
id: test-config
files:
  config/settings.json:
    content:
      key: value
repos:
  - git: git@github.com:org/repo.git
`);
      const config = loadConfig(path);
      assert.equal(config.repos[0].files[0].fileName, "config/settings.json");
    });

    test("validates git field in array syntax", () => {
      const path = createTestConfig(`
id: test-config
files:
  config.json:
    content:
      key: value
repos:
  - git:
      - git@github.com:org/repo1.git
      - git@github.com:org/repo2.git
`);
      const config = loadConfig(path);
      assert.equal(config.repos.length, 2);
    });
  });

  describe("git array expansion", () => {
    test("single git string unchanged", () => {
      const path = createTestConfig(`
id: test-config
files:
  config.json:
    content:
      key: value
repos:
  - git: git@github.com:org/repo.git
`);
      const config = loadConfig(path);
      assert.equal(config.repos.length, 1);
      assert.equal(config.repos[0].git, "git@github.com:org/repo.git");
    });

    test("git array expands to multiple entries", () => {
      const path = createTestConfig(`
id: test-config
files:
  config.json:
    content:
      key: value
repos:
  - git:
      - git@github.com:org/repo1.git
      - git@github.com:org/repo2.git
      - git@github.com:org/repo3.git
`);
      const config = loadConfig(path);
      assert.equal(config.repos.length, 3);
      assert.equal(config.repos[0].git, "git@github.com:org/repo1.git");
      assert.equal(config.repos[1].git, "git@github.com:org/repo2.git");
      assert.equal(config.repos[2].git, "git@github.com:org/repo3.git");
    });

    test("preserves content across expanded entries", () => {
      const path = createTestConfig(`
id: test-config
files:
  config.json:
    content:
      shared: value
repos:
  - git:
      - git@github.com:org/repo1.git
      - git@github.com:org/repo2.git
`);
      const config = loadConfig(path);
      assert.deepEqual(config.repos[0].files[0].content, { shared: "value" });
      assert.deepEqual(config.repos[1].files[0].content, { shared: "value" });
    });
  });

  describe("content merging", () => {
    test("uses file base content when repo has no override", () => {
      const path = createTestConfig(`
id: test-config
files:
  config.json:
    content:
      base: value
      nested:
        key: nested-value
repos:
  - git: git@github.com:org/repo.git
`);
      const config = loadConfig(path);
      assert.deepEqual(config.repos[0].files[0].content, {
        base: "value",
        nested: { key: "nested-value" },
      });
    });

    test("merges repo file content onto file base content", () => {
      const path = createTestConfig(`
id: test-config
files:
  config.json:
    content:
      base: value
      override: original
repos:
  - git: git@github.com:org/repo.git
    files:
      config.json:
        content:
          override: updated
          added: new
`);
      const config = loadConfig(path);
      assert.deepEqual(config.repos[0].files[0].content, {
        base: "value",
        override: "updated",
        added: "new",
      });
    });

    test("deep merges nested objects", () => {
      const path = createTestConfig(`
id: test-config
files:
  config.json:
    content:
      nested:
        a: 1
        b: 2
repos:
  - git: git@github.com:org/repo.git
    files:
      config.json:
        content:
          nested:
            b: 3
            c: 4
`);
      const config = loadConfig(path);
      assert.deepEqual(config.repos[0].files[0].content, {
        nested: { a: 1, b: 3, c: 4 },
      });
    });

    test("override: true uses only repo file content", () => {
      const path = createTestConfig(`
id: test-config
files:
  config.json:
    content:
      base: value
      nested:
        key: nested-value
repos:
  - git: git@github.com:org/repo.git
    files:
      config.json:
        override: true
        content:
          only: repo-value
`);
      const config = loadConfig(path);
      assert.deepEqual(config.repos[0].files[0].content, {
        only: "repo-value",
      });
    });

    test("override requires content field", () => {
      const path = createTestConfig(`
id: test-config
files:
  config.json:
    content:
      base: value
repos:
  - git: git@github.com:org/repo.git
    files:
      config.json:
        override: true
`);
      assert.throws(
        () => loadConfig(path),
        /override: true for file 'config.json' but no content defined/
      );
    });

    test("arrays are replaced by default", () => {
      const path = createTestConfig(`
id: test-config
files:
  config.json:
    content:
      items:
        - base1
        - base2
repos:
  - git: git@github.com:org/repo.git
    files:
      config.json:
        content:
          items:
            - override1
`);
      const config = loadConfig(path);
      assert.deepEqual(config.repos[0].files[0].content, {
        items: ["override1"],
      });
    });

    test("per-file mergeStrategy: append concatenates arrays", () => {
      const path = createTestConfig(`
id: test-config
files:
  config.json:
    mergeStrategy: append
    content:
      items:
        - base1
        - base2
repos:
  - git: git@github.com:org/repo.git
    files:
      config.json:
        content:
          items:
            - added1
            - added2
`);
      const config = loadConfig(path);
      assert.deepEqual(config.repos[0].files[0].content, {
        items: ["base1", "base2", "added1", "added2"],
      });
    });
  });

  describe("environment variable interpolation", () => {
    test("interpolates env vars in content values", () => {
      const path = createTestConfig(`
id: test-config
files:
  config.json:
    content:
      value: \${TEST_ENV_VAR}
repos:
  - git: git@github.com:org/repo.git
`);
      const config = loadConfig(path);
      assert.deepEqual(config.repos[0].files[0].content, {
        value: "test-value",
      });
    });

    test("throws on missing env var by default", () => {
      const path = createTestConfig(`
id: test-config
files:
  config.json:
    content:
      value: \${MISSING_VAR}
repos:
  - git: git@github.com:org/repo.git
`);
      assert.throws(
        () => loadConfig(path),
        /Missing required environment variable: MISSING_VAR/
      );
    });

    test("uses default value when env var missing", () => {
      const path = createTestConfig(`
id: test-config
files:
  config.json:
    content:
      value: \${MISSING_VAR:-default-value}
repos:
  - git: git@github.com:org/repo.git
`);
      const config = loadConfig(path);
      assert.deepEqual(config.repos[0].files[0].content, {
        value: "default-value",
      });
    });
  });

  describe("multiple files", () => {
    test("all repos receive all files by default", () => {
      const path = createTestConfig(`
id: test-config
files:
  eslint.json:
    content:
      extends:
        - "@company/base"
  prettier.json:
    content:
      singleQuote: true
repos:
  - git: git@github.com:org/repo1.git
  - git: git@github.com:org/repo2.git
`);
      const config = loadConfig(path);
      assert.equal(config.repos.length, 2);
      assert.equal(config.repos[0].files.length, 2);
      assert.equal(config.repos[1].files.length, 2);
    });

    test("each file can have its own mergeStrategy", () => {
      const path = createTestConfig(`
id: test-config
files:
  append.json:
    mergeStrategy: append
    content:
      items:
        - a
  replace.json:
    content:
      items:
        - x
repos:
  - git: git@github.com:org/repo.git
    files:
      append.json:
        content:
          items:
            - b
      replace.json:
        content:
          items:
            - y
`);
      const config = loadConfig(path);
      const appendFile = config.repos[0].files.find(
        (f) => f.fileName === "append.json"
      );
      const replaceFile = config.repos[0].files.find(
        (f) => f.fileName === "replace.json"
      );
      assert.deepEqual(
        (appendFile?.content as Record<string, unknown>)?.items,
        ["a", "b"]
      );
      assert.deepEqual(
        (replaceFile?.content as Record<string, unknown>)?.items,
        ["y"]
      );
    });
  });

  describe("integration", () => {
    test("full config with all features", () => {
      const path = createTestConfig(`
id: test-config
files:
  my.config.json:
    content:
      version: "1.0"
      common: shared
      features:
        - core
repos:
  - git:
      - git@github.com:org/repo1.git
      - git@github.com:org/repo2.git
    files:
      my.config.json:
        content:
          team: platform
  - git: git@github.com:org/repo3.git
  - git: git@github.com:org/repo4.git
    files:
      my.config.json:
        override: true
        content:
          legacy: true
`);
      const config = loadConfig(path);

      assert.equal(config.repos[0].files[0].fileName, "my.config.json");
      assert.equal(config.repos.length, 4);

      // Expanded array repos with merge
      assert.equal(config.repos[0].git, "git@github.com:org/repo1.git");
      assert.deepEqual(config.repos[0].files[0].content, {
        version: "1.0",
        common: "shared",
        features: ["core"],
        team: "platform",
      });

      assert.equal(config.repos[1].git, "git@github.com:org/repo2.git");
      assert.deepEqual(
        config.repos[1].files[0].content,
        config.repos[0].files[0].content
      );

      // Repo with no override - uses file base content
      assert.equal(config.repos[2].git, "git@github.com:org/repo3.git");
      assert.deepEqual(config.repos[2].files[0].content, {
        version: "1.0",
        common: "shared",
        features: ["core"],
      });

      // Repo with override
      assert.equal(config.repos[3].git, "git@github.com:org/repo4.git");
      assert.deepEqual(config.repos[3].files[0].content, { legacy: true });
    });

    test("file references are resolved before validation", () => {
      // Create a template file in the test directory
      const templatePath = join(testDir, "templates", "base.json");
      mkdirSync(join(testDir, "templates"), { recursive: true });
      writeFileSync(templatePath, '{"base": true, "version": "1.0"}', "utf-8");

      const path = createTestConfig(`
id: test-config
files:
  config.json:
    content: "@templates/base.json"
repos:
  - git: git@github.com:org/repo.git
`);
      const config = loadConfig(path);
      assert.deepEqual(config.repos[0].files[0].content, {
        base: true,
        version: "1.0",
      });
    });

    test("file references work with per-repo merging", () => {
      const templatePath = join(testDir, "templates", "base.json");
      mkdirSync(join(testDir, "templates"), { recursive: true });
      writeFileSync(
        templatePath,
        '{"base": true, "features": ["core"]}',
        "utf-8"
      );

      const path = createTestConfig(`
id: test-config
files:
  config.json:
    content: "@templates/base.json"
repos:
  - git: git@github.com:org/repo.git
    files:
      config.json:
        content:
          custom: added
`);
      const config = loadConfig(path);
      assert.deepEqual(config.repos[0].files[0].content, {
        base: true,
        features: ["core"],
        custom: "added",
      });
    });

    test("file references work for text files", () => {
      const templatePath = join(testDir, "templates", "gitignore.txt");
      mkdirSync(join(testDir, "templates"), { recursive: true });
      writeFileSync(templatePath, "node_modules/\ndist/", "utf-8");

      const path = createTestConfig(`
id: test-config
files:
  .gitignore:
    content: "@templates/gitignore.txt"
repos:
  - git: git@github.com:org/repo.git
`);
      const config = loadConfig(path);
      assert.strictEqual(
        config.repos[0].files[0].content,
        "node_modules/\ndist/"
      );
    });

    test("file reference with header and schemaUrl", () => {
      const templatePath = join(testDir, "templates", "eslint.yaml");
      mkdirSync(join(testDir, "templates"), { recursive: true });
      writeFileSync(templatePath, "root: true\nenv:\n  node: true", "utf-8");

      const path = createTestConfig(`
id: test-config
files:
  .eslintrc.yaml:
    content: "@templates/eslint.yaml"
    header: "Auto-generated"
    schemaUrl: "https://example.com/schema"
repos:
  - git: git@github.com:org/repo.git
`);
      const config = loadConfig(path);
      const file = config.repos[0].files[0];
      assert.deepEqual(file.content, { root: true, env: { node: true } });
      assert.deepEqual(file.header, ["Auto-generated"]);
      assert.strictEqual(file.schemaUrl, "https://example.com/schema");
    });
  });
});

describe("prOptions", () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("parses global prOptions", () => {
    const path = createTestConfig(`
id: test-config
files:
  config.json:
    content:
      key: value
prOptions:
  merge: auto
  mergeStrategy: squash
  deleteBranch: true
repos:
  - git: git@github.com:org/repo.git
`);
    const config = loadConfig(path);
    assert.deepEqual(config.repos[0].prOptions, {
      merge: "auto",
      mergeStrategy: "squash",
      deleteBranch: true,
    });
  });

  test("parses per-repo prOptions", () => {
    const path = createTestConfig(`
id: test-config
files:
  config.json:
    content:
      key: value
repos:
  - git: git@github.com:org/repo.git
    prOptions:
      merge: force
      bypassReason: "Automated sync"
`);
    const config = loadConfig(path);
    assert.deepEqual(config.repos[0].prOptions, {
      merge: "force",
      bypassReason: "Automated sync",
    });
  });

  test("per-repo prOptions overrides global", () => {
    const path = createTestConfig(`
id: test-config
files:
  config.json:
    content:
      key: value
prOptions:
  merge: auto
  mergeStrategy: squash
  deleteBranch: true
repos:
  - git: git@github.com:org/repo.git
    prOptions:
      merge: force
`);
    const config = loadConfig(path);
    assert.deepEqual(config.repos[0].prOptions, {
      merge: "force",
      mergeStrategy: "squash",
      deleteBranch: true,
    });
  });

  test("per-repo prOptions partial override", () => {
    const path = createTestConfig(`
id: test-config
files:
  config.json:
    content:
      key: value
prOptions:
  merge: auto
  mergeStrategy: squash
repos:
  - git: git@github.com:org/repo1.git
  - git: git@github.com:org/repo2.git
    prOptions:
      mergeStrategy: rebase
`);
    const config = loadConfig(path);
    // First repo uses global settings
    assert.deepEqual(config.repos[0].prOptions, {
      merge: "auto",
      mergeStrategy: "squash",
    });
    // Second repo overrides mergeStrategy but inherits merge
    assert.deepEqual(config.repos[1].prOptions, {
      merge: "auto",
      mergeStrategy: "rebase",
    });
  });

  test("no prOptions returns undefined", () => {
    const path = createTestConfig(`
id: test-config
files:
  config.json:
    content:
      key: value
repos:
  - git: git@github.com:org/repo.git
`);
    const config = loadConfig(path);
    assert.strictEqual(config.repos[0].prOptions, undefined);
  });

  test("prOptions with git array expansion", () => {
    const path = createTestConfig(`
id: test-config
files:
  config.json:
    content:
      key: value
prOptions:
  merge: auto
repos:
  - git:
      - git@github.com:org/repo1.git
      - git@github.com:org/repo2.git
    prOptions:
      mergeStrategy: squash
`);
    const config = loadConfig(path);
    assert.equal(config.repos.length, 2);
    // Both expanded repos should have merged prOptions
    assert.deepEqual(config.repos[0].prOptions, {
      merge: "auto",
      mergeStrategy: "squash",
    });
    assert.deepEqual(config.repos[1].prOptions, {
      merge: "auto",
      mergeStrategy: "squash",
    });
  });
});

describe("convertContentToString", () => {
  test("produces valid JSON for .json files", () => {
    const input = { key: "value", nested: { foo: "bar" } };
    const result = convertContentToString(input, "config.json");
    const parsed = JSON.parse(result);
    assert.deepEqual(parsed, input);
  });

  test("uses 2-space indentation for JSON", () => {
    const input = { key: "value" };
    const result = convertContentToString(input, "config.json");
    assert.equal(result, '{\n  "key": "value"\n}\n');
  });

  test("produces valid YAML for .yaml files", () => {
    const input = { key: "value", nested: { foo: "bar" } };
    const result = convertContentToString(input, "config.yaml");
    const parsed = parse(result);
    assert.deepEqual(parsed, input);
  });

  test("produces valid YAML for .yml files", () => {
    const input = { key: "value", nested: { foo: "bar" } };
    const result = convertContentToString(input, "config.yml");
    const parsed = parse(result);
    assert.deepEqual(parsed, input);
  });

  test("defaults to JSON for unknown extensions", () => {
    const input = { key: "value" };
    const result = convertContentToString(input, "config.json");
    assert.equal(result, '{\n  "key": "value"\n}\n');
  });

  test("handles case-insensitive extensions", () => {
    const input = { key: "value" };
    const resultYaml = convertContentToString(input, "config.YAML");
    const resultYml = convertContentToString(input, "config.YML");
    // Both should produce valid YAML (not starting with {)
    assert.ok(!resultYaml.startsWith("{"));
    assert.ok(!resultYml.startsWith("{"));
  });
});

describe("settings types", () => {
  test("Ruleset has all expected fields", () => {
    const ruleset: Ruleset = {
      target: "branch",
      enforcement: "active",
      bypassActors: [
        { actorId: 123, actorType: "Integration", bypassMode: "always" },
      ],
      conditions: { refName: { include: ["refs/heads/main"] } },
      rules: [{ type: "required_signatures" }],
    };
    assert.equal(ruleset.target, "branch");
    assert.equal(ruleset.enforcement, "active");
    assert.equal(ruleset.bypassActors?.[0].actorId, 123);
  });

  test("Ruleset supports all GitHub Rulesets API fields", () => {
    const ruleset: Ruleset = {
      target: "branch",
      enforcement: "active",
      bypassActors: [
        { actorId: 2719952, actorType: "Integration", bypassMode: "always" },
        { actorId: 123, actorType: "Team", bypassMode: "pull_request" },
      ],
      conditions: {
        refName: {
          include: ["refs/heads/main", "refs/heads/release/*"],
          exclude: ["refs/heads/dev*"],
        },
      },
      rules: [
        {
          type: "pull_request",
          parameters: {
            requiredApprovingReviewCount: 2,
            dismissStaleReviewsOnPush: true,
            requireCodeOwnerReview: true,
            requireLastPushApproval: false,
            requiredReviewThreadResolution: true,
            allowedMergeMethods: ["squash"],
          },
        },
        {
          type: "required_status_checks",
          parameters: {
            strictRequiredStatusChecksPolicy: true,
            doNotEnforceOnCreate: false,
            requiredStatusChecks: [{ context: "ci/build" }],
          },
        },
        { type: "required_signatures" },
        { type: "required_linear_history" },
        { type: "non_fast_forward" },
        {
          type: "code_scanning",
          parameters: {
            codeScanningTools: [
              {
                tool: "CodeQL",
                alertsThreshold: "errors",
                securityAlertsThreshold: "high_or_higher",
              },
            ],
          },
        },
      ],
    };
    assert.equal(ruleset.bypassActors?.length, 2);
    assert.equal(ruleset.conditions?.refName?.include?.length, 2);
    assert.equal(ruleset.rules?.length, 6);
  });

  test("BypassActor supports all actor types", () => {
    const actors: BypassActor[] = [
      { actorId: 1, actorType: "Integration", bypassMode: "always" },
      { actorId: 2, actorType: "Team", bypassMode: "pull_request" },
      { actorId: 3, actorType: "User" },
    ];
    assert.equal(actors[0].actorType, "Integration");
    assert.equal(actors[1].actorType, "Team");
    assert.equal(actors[2].actorType, "User");
  });

  test("StatusCheckConfig supports context and integrationId", () => {
    const check: StatusCheckConfig = { context: "ci/test", integrationId: 456 };
    assert.equal(check.context, "ci/test");
    assert.equal(check.integrationId, 456);
  });

  test("CodeScanningTool supports all threshold options", () => {
    const tool: CodeScanningTool = {
      tool: "CodeQL",
      alertsThreshold: "errors",
      securityAlertsThreshold: "high_or_higher",
    };
    assert.equal(tool.tool, "CodeQL");
    assert.equal(tool.alertsThreshold, "errors");
    assert.equal(tool.securityAlertsThreshold, "high_or_higher");
  });

  test("RulesetRule discriminated union works correctly", () => {
    const rules: RulesetRule[] = [
      { type: "pull_request", parameters: { requiredApprovingReviewCount: 1 } },
      { type: "required_signatures" },
      {
        type: "commit_message_pattern",
        parameters: { operator: "regex", pattern: "^feat:" },
      },
    ];
    assert.equal(rules[0].type, "pull_request");
    assert.equal(rules[1].type, "required_signatures");
    assert.equal(rules[2].type, "commit_message_pattern");
  });

  test("RepoSettings includes rulesets map", () => {
    const settings: RepoSettings = {
      rulesets: {
        "pr-rules": {
          target: "branch",
          enforcement: "active",
          rules: [
            {
              type: "pull_request",
              parameters: { requiredApprovingReviewCount: 1 },
            },
          ],
        },
      },
    };
    assert.ok(settings.rulesets?.["pr-rules"]);
    assert.equal(settings.rulesets?.["pr-rules"]?.enforcement, "active");
  });
});

describe("raw settings types", () => {
  test("RawRepoSettings can hold rulesets", () => {
    const settings: RawRepoSettings = {
      rulesets: {
        "pr-rules": { target: "branch", enforcement: "active" },
      },
    };
    assert.ok(settings.rulesets);
  });

  test("RawConfig can include settings at root", () => {
    const config: RawConfig = {
      id: "test",
      files: {},
      repos: [],
      settings: {
        rulesets: {
          "pr-rules": { target: "branch", enforcement: "active" },
        },
      },
    };
    assert.ok(config.settings?.rulesets);
  });

  test("RawRepoConfig can include settings", () => {
    const repo: RawRepoConfig = {
      git: "org/repo",
      settings: {
        rulesets: {
          "pr-rules": { target: "branch", enforcement: "active" },
        },
      },
    };
    assert.ok(repo.settings?.rulesets);
  });
});

describe("normalized config types", () => {
  test("RepoConfig can include resolved settings", () => {
    const repo: RepoConfig = {
      git: "org/repo",
      files: [],
      settings: {
        rulesets: {
          "pr-rules": { target: "branch", enforcement: "active" },
        },
      },
    };
    assert.ok(repo.settings?.rulesets);
  });

  test("Config can include root settings", () => {
    const config: Config = {
      id: "test",
      repos: [],
      settings: {
        rulesets: {
          "pr-rules": { target: "branch", enforcement: "active" },
        },
      },
    };
    assert.ok(config.settings?.rulesets);
  });
});
