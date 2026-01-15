import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadConfig, convertContentToString } from "./config.js";
import { parse } from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, "..", "fixtures");
const expectedDir = join(fixturesDir, "expected");

// Create a temporary directory for test fixtures
const testDir = join(tmpdir(), "json-config-sync-test-" + Date.now());

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
  });

  describe("validation", () => {
    test("throws when fileName missing", () => {
      const path = createTestConfig(`
repos:
  - git: git@github.com:org/repo.git
    content:
      key: value
`);
      assert.throws(
        () => loadConfig(path),
        /Config missing required field: fileName/,
      );
    });

    test("throws when repos missing", () => {
      const path = createTestConfig(`
fileName: config.json
`);
      assert.throws(
        () => loadConfig(path),
        /Config missing required field: repos/,
      );
    });

    test("throws when repos not an array", () => {
      const path = createTestConfig(`
fileName: config.json
repos: not-an-array
`);
      assert.throws(() => loadConfig(path), /repos \(must be an array\)/);
    });

    test("throws when repo.git missing", () => {
      const path = createTestConfig(`
fileName: config.json
repos:
  - content:
    key: value
`);
      assert.throws(
        () => loadConfig(path),
        /Repo at index 0 missing required field: git/,
      );
    });

    test("throws when fileName contains path traversal", () => {
      const path = createTestConfig(`
fileName: ../escape.json
repos:
  - git: git@github.com:org/repo.git
    content:
      key: value
`);
      assert.throws(
        () => loadConfig(path),
        /Invalid fileName: must be a relative path without '\.\.' components/,
      );
    });

    test("throws when fileName is absolute path", () => {
      const path = createTestConfig(`
fileName: /etc/passwd
repos:
  - git: git@github.com:org/repo.git
    content:
      key: value
`);
      assert.throws(
        () => loadConfig(path),
        /Invalid fileName: must be a relative path without '\.\.' components/,
      );
    });

    test("allows nested relative paths without traversal", () => {
      const path = createTestConfig(`
fileName: config/settings.json
repos:
  - git: git@github.com:org/repo.git
    content:
      key: value
`);
      const config = loadConfig(path);
      assert.equal(config.fileName, "config/settings.json");
    });

    test("allows missing repo.content when root content exists", () => {
      const path = createTestConfig(`
fileName: config.json
content:
  rootKey: rootValue
repos:
  - git: git@github.com:org/repo.git
`);
      const config = loadConfig(path);
      assert.equal(config.repos.length, 1);
      assert.deepEqual(config.repos[0].content, { rootKey: "rootValue" });
    });

    test("throws when repo.content missing and no root content", () => {
      const path = createTestConfig(`
fileName: config.json
repos:
  - git: git@github.com:org/repo.git
`);
      assert.throws(
        () => loadConfig(path),
        /Repo at index 0 missing required field: content/,
      );
    });

    test("validates git field in array syntax", () => {
      const path = createTestConfig(`
fileName: config.json
repos:
  - git:
      - git@github.com:org/repo1.git
      - git@github.com:org/repo2.git
    content:
      key: value
`);
      const config = loadConfig(path);
      assert.equal(config.repos.length, 2);
    });
  });

  describe("git array expansion", () => {
    test("single git string unchanged", () => {
      const path = createTestConfig(`
fileName: config.json
repos:
  - git: git@github.com:org/repo.git
    content:
      key: value
`);
      const config = loadConfig(path);
      assert.equal(config.repos.length, 1);
      assert.equal(config.repos[0].git, "git@github.com:org/repo.git");
    });

    test("git array expands to multiple entries", () => {
      const path = createTestConfig(`
fileName: config.json
repos:
  - git:
      - git@github.com:org/repo1.git
      - git@github.com:org/repo2.git
      - git@github.com:org/repo3.git
    content:
      key: value
`);
      const config = loadConfig(path);
      assert.equal(config.repos.length, 3);
      assert.equal(config.repos[0].git, "git@github.com:org/repo1.git");
      assert.equal(config.repos[1].git, "git@github.com:org/repo2.git");
      assert.equal(config.repos[2].git, "git@github.com:org/repo3.git");
    });

    test("preserves content across expanded entries", () => {
      const path = createTestConfig(`
fileName: config.json
repos:
  - git:
      - git@github.com:org/repo1.git
      - git@github.com:org/repo2.git
    content:
      shared: value
`);
      const config = loadConfig(path);
      assert.deepEqual(config.repos[0].content, { shared: "value" });
      assert.deepEqual(config.repos[1].content, { shared: "value" });
    });

    test("mixed single and array git entries", () => {
      const path = createTestConfig(`
fileName: config.json
repos:
  - git: git@github.com:org/single.git
    content:
      type: single
  - git:
      - git@github.com:org/array1.git
      - git@github.com:org/array2.git
    content:
      type: array
`);
      const config = loadConfig(path);
      assert.equal(config.repos.length, 3);
      assert.equal(config.repos[0].git, "git@github.com:org/single.git");
      assert.deepEqual(config.repos[0].content, { type: "single" });
      assert.equal(config.repos[1].git, "git@github.com:org/array1.git");
      assert.deepEqual(config.repos[1].content, { type: "array" });
      assert.equal(config.repos[2].git, "git@github.com:org/array2.git");
      assert.deepEqual(config.repos[2].content, { type: "array" });
    });
  });

  describe("content inheritance", () => {
    test("uses root content when repo.content missing", () => {
      const path = createTestConfig(`
fileName: config.json
content:
  base: value
  nested:
    key: nested-value
repos:
  - git: git@github.com:org/repo.git
`);
      const config = loadConfig(path);
      assert.deepEqual(config.repos[0].content, {
        base: "value",
        nested: { key: "nested-value" },
      });
    });

    test("merges repo.content onto root content", () => {
      const path = createTestConfig(`
fileName: config.json
content:
  base: value
  override: original
repos:
  - git: git@github.com:org/repo.git
    content:
      override: updated
      added: new
`);
      const config = loadConfig(path);
      assert.deepEqual(config.repos[0].content, {
        base: "value",
        override: "updated",
        added: "new",
      });
    });

    test("deep merges nested objects", () => {
      const path = createTestConfig(`
fileName: config.json
content:
  nested:
    a: 1
    b: 2
repos:
  - git: git@github.com:org/repo.git
    content:
      nested:
        b: 3
        c: 4
`);
      const config = loadConfig(path);
      assert.deepEqual(config.repos[0].content, {
        nested: { a: 1, b: 3, c: 4 },
      });
    });

    test("override: true uses only repo content", () => {
      const path = createTestConfig(`
fileName: config.json
content:
  base: value
  nested:
    key: nested-value
repos:
  - git: git@github.com:org/repo.git
    override: true
    content:
      only: repo-value
`);
      const config = loadConfig(path);
      assert.deepEqual(config.repos[0].content, { only: "repo-value" });
    });

    test("override requires content field", () => {
      const path = createTestConfig(`
fileName: config.json
content:
  base: value
repos:
  - git: git@github.com:org/repo.git
    override: true
`);
      assert.throws(
        () => loadConfig(path),
        /override: true but no content defined/,
      );
    });

    test("arrays are replaced by default", () => {
      const path = createTestConfig(`
fileName: config.json
content:
  items:
    - base1
    - base2
repos:
  - git: git@github.com:org/repo.git
    content:
      items:
        - override1
`);
      const config = loadConfig(path);
      assert.deepEqual(config.repos[0].content, { items: ["override1"] });
    });

    test("$arrayMerge: append concatenates arrays", () => {
      const path = createTestConfig(`
fileName: config.json
content:
  items:
    - base1
    - base2
repos:
  - git: git@github.com:org/repo.git
    content:
      items:
        $arrayMerge: append
        values:
          - added1
          - added2
`);
      const config = loadConfig(path);
      assert.deepEqual(config.repos[0].content, {
        items: ["base1", "base2", "added1", "added2"],
      });
    });

    test("$arrayMerge directive is stripped from output", () => {
      const path = createTestConfig(`
fileName: config.json
content:
  items:
    - base
repos:
  - git: git@github.com:org/repo.git
    content:
      items:
        $arrayMerge: append
        values:
          - added
`);
      const config = loadConfig(path);
      const jsonStr = JSON.stringify(config.repos[0].content);
      assert.equal(jsonStr.includes("$arrayMerge"), false);
    });

    test("global mergeStrategy affects all arrays", () => {
      const path = createTestConfig(`
fileName: config.json
mergeStrategy: append
content:
  items1:
    - a
  items2:
    - x
repos:
  - git: git@github.com:org/repo.git
    content:
      items1:
        - b
      items2:
        - y
`);
      const config = loadConfig(path);
      assert.deepEqual(config.repos[0].content, {
        items1: ["a", "b"],
        items2: ["x", "y"],
      });
    });
  });

  describe("environment variable interpolation", () => {
    test("interpolates env vars in content values", () => {
      const path = createTestConfig(`
fileName: config.json
repos:
  - git: git@github.com:org/repo.git
    content:
      value: \${TEST_ENV_VAR}
`);
      const config = loadConfig(path);
      assert.deepEqual(config.repos[0].content, { value: "test-value" });
    });

    test("interpolates env vars in root content", () => {
      const path = createTestConfig(`
fileName: config.json
content:
  rootValue: \${TEST_ENV_VAR}
repos:
  - git: git@github.com:org/repo.git
`);
      const config = loadConfig(path);
      assert.deepEqual(config.repos[0].content, { rootValue: "test-value" });
    });

    test("throws on missing env var by default", () => {
      const path = createTestConfig(`
fileName: config.json
repos:
  - git: git@github.com:org/repo.git
    content:
      value: \${MISSING_VAR}
`);
      assert.throws(
        () => loadConfig(path),
        /Missing required environment variable: MISSING_VAR/,
      );
    });

    test("uses default value when env var missing", () => {
      const path = createTestConfig(`
fileName: config.json
repos:
  - git: git@github.com:org/repo.git
    content:
      value: \${MISSING_VAR:-default-value}
`);
      const config = loadConfig(path);
      assert.deepEqual(config.repos[0].content, { value: "default-value" });
    });
  });

  describe("integration", () => {
    test("full config with all features", () => {
      const path = createTestConfig(`
fileName: my.config.json
mergeStrategy: replace
content:
  version: "1.0"
  common: shared
  features:
    - core
repos:
  - git:
      - git@github.com:org/repo1.git
      - git@github.com:org/repo2.git
    content:
      team: platform
  - git: git@github.com:org/repo3.git
  - git: git@github.com:org/repo4.git
    override: true
    content:
      legacy: true
`);
      const config = loadConfig(path);

      assert.equal(config.fileName, "my.config.json");
      assert.equal(config.repos.length, 4);

      // Expanded array repos with merge
      assert.equal(config.repos[0].git, "git@github.com:org/repo1.git");
      assert.deepEqual(config.repos[0].content, {
        version: "1.0",
        common: "shared",
        features: ["core"],
        team: "platform",
      });

      assert.equal(config.repos[1].git, "git@github.com:org/repo2.git");
      assert.deepEqual(config.repos[1].content, config.repos[0].content);

      // Repo with no content - uses root content
      assert.equal(config.repos[2].git, "git@github.com:org/repo3.git");
      assert.deepEqual(config.repos[2].content, {
        version: "1.0",
        common: "shared",
        features: ["core"],
      });

      // Repo with override
      assert.equal(config.repos[3].git, "git@github.com:org/repo4.git");
      assert.deepEqual(config.repos[3].content, { legacy: true });
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
    assert.equal(result, '{\n  "key": "value"\n}');
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
    const result = convertContentToString(input, "config.txt");
    assert.equal(result, '{\n  "key": "value"\n}');
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

// Helper to load expected JSON from fixture
function loadExpected(name: string): Record<string, unknown> {
  const path = join(expectedDir, `${name}.json`);
  return JSON.parse(readFileSync(path, "utf-8"));
}

describe("Fixture-based tests", () => {
  describe("full-features.yaml", () => {
    const configPath = join(fixturesDir, "full-features.yaml");

    test("expands git array to correct number of repos", () => {
      const config = loadConfig(configPath);
      // 2 from array + 1 inherit + 1 override + 1 append + 1 prepend = 6
      assert.equal(config.repos.length, 6);
    });

    test("repo-array-1: git array with overlay merge", () => {
      const config = loadConfig(configPath);
      const expected = loadExpected("repo-array-1");
      assert.equal(config.repos[0].git, "git@github.com:org/repo-array-1.git");
      assert.deepEqual(config.repos[0].content, expected);
    });

    test("repo-array-2: git array produces identical content", () => {
      const config = loadConfig(configPath);
      const expected = loadExpected("repo-array-1"); // Same as repo-array-1
      assert.equal(config.repos[1].git, "git@github.com:org/repo-array-2.git");
      assert.deepEqual(config.repos[1].content, expected);
    });

    test("repo-inherit: uses root content unchanged", () => {
      const config = loadConfig(configPath);
      const expected = loadExpected("repo-inherit");
      assert.equal(config.repos[2].git, "git@github.com:org/repo-inherit.git");
      assert.deepEqual(config.repos[2].content, expected);
    });

    test("repo-override: ignores root content entirely", () => {
      const config = loadConfig(configPath);
      const expected = loadExpected("repo-override");
      assert.equal(config.repos[3].git, "git@github.com:org/repo-override.git");
      assert.deepEqual(config.repos[3].content, expected);
    });

    test("repo-append: $arrayMerge append works", () => {
      const config = loadConfig(configPath);
      const expected = loadExpected("repo-append");
      assert.equal(config.repos[4].git, "git@github.com:org/repo-append.git");
      assert.deepEqual(config.repos[4].content, expected);
    });

    test("repo-prepend: $arrayMerge prepend works", () => {
      const config = loadConfig(configPath);
      const expected = loadExpected("repo-prepend");
      assert.equal(config.repos[5].git, "git@github.com:org/repo-prepend.git");
      assert.deepEqual(config.repos[5].content, expected);
    });
  });

  describe("global-merge-strategy.yaml", () => {
    const configPath = join(fixturesDir, "global-merge-strategy.yaml");

    test("global mergeStrategy: append affects all arrays", () => {
      const config = loadConfig(configPath);
      const expected = loadExpected("repo-global-append");
      assert.equal(
        config.repos[0].git,
        "git@github.com:org/repo-global-append.git",
      );
      assert.deepEqual(config.repos[0].content, expected);
    });
  });

  describe("env-vars.yaml", () => {
    const configPath = join(fixturesDir, "env-vars.yaml");

    beforeEach(() => {
      process.env.API_URL = "https://api.example.com";
      process.env.SERVICE_NAME = "my-service";
    });

    afterEach(() => {
      delete process.env.API_URL;
      delete process.env.SERVICE_NAME;
    });

    test("interpolates env vars with defaults and required", () => {
      const config = loadConfig(configPath);
      const expected = loadExpected("repo-env");
      assert.equal(config.repos[0].git, "git@github.com:org/repo-env.git");
      assert.deepEqual(config.repos[0].content, expected);
    });

    test("throws when required env var missing", () => {
      delete process.env.API_URL;
      assert.throws(
        () => loadConfig(configPath),
        /Missing required environment variable: API_URL/,
      );
    });
  });

  describe("test-repos-input.yaml (original fixture)", () => {
    const configPath = join(fixturesDir, "test-repos-input.yaml");

    test("expands to 3 repos", () => {
      const config = loadConfig(configPath);
      assert.equal(config.repos.length, 3);
    });

    test("first repo has merged content with array replaced", () => {
      const config = loadConfig(configPath);
      const expectedPath = join(fixturesDir, "test-repo-output.json");
      const expected = JSON.parse(readFileSync(expectedPath, "utf-8"));
      assert.deepEqual(config.repos[0].content, expected);
    });

    test("second repo has same content as first", () => {
      const config = loadConfig(configPath);
      assert.deepEqual(config.repos[0].content, config.repos[1].content);
    });

    test("third repo has different overlay", () => {
      const config = loadConfig(configPath);
      assert.deepEqual(config.repos[2].content.prop4, {
        prop5: [{ prop6: "data" }],
      });
    });
  });
});
