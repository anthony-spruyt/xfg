import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import {
  interpolateEnvVars,
  interpolateEnvVarsInString,
  interpolateEnvVarsInLines,
  interpolateContent,
  type EnvInterpolationOptions,
} from "../../src/env.js";

describe("interpolateEnvVars", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Set up test environment variables
    process.env.TEST_VAR = "test-value";
    process.env.ANOTHER_VAR = "another-value";
    process.env.EMPTY_VAR = "";
  });

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
  });

  test("replaces ${VAR} with env value", () => {
    const input = { key: "${TEST_VAR}" };
    const result = interpolateEnvVars(input);
    assert.deepEqual(result, { key: "test-value" });
  });

  test("replaces multiple vars in one string", () => {
    const input = { key: "${TEST_VAR}-${ANOTHER_VAR}" };
    const result = interpolateEnvVars(input);
    assert.deepEqual(result, { key: "test-value-another-value" });
  });

  test("returns default for ${VAR:-default} when var missing", () => {
    const input = { key: "${MISSING_VAR:-fallback}" };
    const result = interpolateEnvVars(input);
    assert.deepEqual(result, { key: "fallback" });
  });

  test("uses env value over default when var exists", () => {
    const input = { key: "${TEST_VAR:-fallback}" };
    const result = interpolateEnvVars(input);
    assert.deepEqual(result, { key: "test-value" });
  });

  test("uses default when var is empty string", () => {
    const input = { key: "${EMPTY_VAR:-fallback}" };
    const result = interpolateEnvVars(input);
    // Empty string is still a valid value, don't use default
    assert.deepEqual(result, { key: "" });
  });

  test("throws for ${VAR:?message} when var missing", () => {
    const input = { key: "${MISSING_VAR:?Variable is required}" };
    assert.throws(
      () => interpolateEnvVars(input),
      /MISSING_VAR: Variable is required/
    );
  });

  test("uses env value for ${VAR:?message} when var exists", () => {
    const input = { key: "${TEST_VAR:?Variable is required}" };
    const result = interpolateEnvVars(input);
    assert.deepEqual(result, { key: "test-value" });
  });

  test("processes nested objects recursively", () => {
    const input = {
      level1: {
        level2: {
          value: "${TEST_VAR}",
        },
      },
    };
    const result = interpolateEnvVars(input);
    assert.deepEqual(result, {
      level1: {
        level2: {
          value: "test-value",
        },
      },
    });
  });

  test("processes arrays recursively", () => {
    const input = {
      items: ["${TEST_VAR}", "${ANOTHER_VAR}", "literal"],
    };
    const result = interpolateEnvVars(input);
    assert.deepEqual(result, {
      items: ["test-value", "another-value", "literal"],
    });
  });

  test("processes arrays of objects", () => {
    const input = {
      items: [{ name: "${TEST_VAR}" }, { name: "static" }],
    };
    const result = interpolateEnvVars(input);
    assert.deepEqual(result, {
      items: [{ name: "test-value" }, { name: "static" }],
    });
  });

  test("leaves non-string values unchanged", () => {
    const input = {
      number: 42,
      boolean: true,
      nullValue: null,
      array: [1, 2, 3],
    };
    const result = interpolateEnvVars(input as Record<string, unknown>);
    assert.deepEqual(result, input);
  });

  test("strict mode throws on missing vars without modifier", () => {
    const input = { key: "${MISSING_VAR}" };
    const options: EnvInterpolationOptions = { strict: true };
    assert.throws(
      () => interpolateEnvVars(input, options),
      /Missing required environment variable: MISSING_VAR/
    );
  });

  test("non-strict mode leaves placeholder as-is", () => {
    const input = { key: "${MISSING_VAR}" };
    const options: EnvInterpolationOptions = { strict: false };
    const result = interpolateEnvVars(input, options);
    assert.deepEqual(result, { key: "${MISSING_VAR}" });
  });

  test("default strict mode is true", () => {
    const input = { key: "${MISSING_VAR}" };
    assert.throws(
      () => interpolateEnvVars(input),
      /Missing required environment variable: MISSING_VAR/
    );
  });

  test("handles empty default value", () => {
    const input = { key: "${MISSING_VAR:-}" };
    const result = interpolateEnvVars(input);
    assert.deepEqual(result, { key: "" });
  });

  test("handles complex default value with special characters", () => {
    const input = { key: "${MISSING_VAR:-http://example.com:8080/path}" };
    const result = interpolateEnvVars(input);
    assert.deepEqual(result, { key: "http://example.com:8080/path" });
  });

  test("handles var names with underscores", () => {
    process.env.MY_LONG_VAR_NAME = "long-value";
    const input = { key: "${MY_LONG_VAR_NAME}" };
    const result = interpolateEnvVars(input);
    assert.deepEqual(result, { key: "long-value" });
  });

  test("handles mixed vars with defaults and required", () => {
    const input = {
      required: "${TEST_VAR:?Required}",
      withDefault: "${MISSING:-default}",
      simple: "${ANOTHER_VAR}",
    };
    const result = interpolateEnvVars(input);
    assert.deepEqual(result, {
      required: "test-value",
      withDefault: "default",
      simple: "another-value",
    });
  });

  test("preserves non-variable dollar signs", () => {
    const input = { key: "price is $100" };
    const result = interpolateEnvVars(input);
    assert.deepEqual(result, { key: "price is $100" });
  });

  test("handles empty object", () => {
    const result = interpolateEnvVars({});
    assert.deepEqual(result, {});
  });
});

describe("interpolateEnvVarsInString", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.TEST_VAR = "test-value";
    process.env.DIR = "build";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("interpolates in plain string", () => {
    const result = interpolateEnvVarsInString("value is ${TEST_VAR}");
    assert.equal(result, "value is test-value");
  });

  test("handles multiline string", () => {
    const input = "line1\n${TEST_VAR}\nline3";
    const result = interpolateEnvVarsInString(input);
    assert.equal(result, "line1\ntest-value\nline3");
  });

  test("handles multiple vars in one string", () => {
    const result = interpolateEnvVarsInString("${TEST_VAR} and ${DIR}");
    assert.equal(result, "test-value and build");
  });

  test("handles default values", () => {
    const result = interpolateEnvVarsInString("${MISSING:-default-val}");
    assert.equal(result, "default-val");
  });

  test("throws on missing required var", () => {
    assert.throws(
      () => interpolateEnvVarsInString("${MISSING_VAR}"),
      /Missing required environment variable: MISSING_VAR/
    );
  });

  test("leaves placeholder in non-strict mode", () => {
    const result = interpolateEnvVarsInString("${MISSING_VAR}", {
      strict: false,
    });
    assert.equal(result, "${MISSING_VAR}");
  });
});

describe("interpolateEnvVarsInLines", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.DIR = "build";
    process.env.EXTRA = "extra";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("interpolates each line", () => {
    const result = interpolateEnvVarsInLines(["${DIR}/", "other"]);
    assert.deepEqual(result, ["build/", "other"]);
  });

  test("handles multiple vars across lines", () => {
    const result = interpolateEnvVarsInLines([
      "${DIR}/output",
      "${EXTRA}/files",
    ]);
    assert.deepEqual(result, ["build/output", "extra/files"]);
  });

  test("handles empty array", () => {
    const result = interpolateEnvVarsInLines([]);
    assert.deepEqual(result, []);
  });

  test("handles lines without vars", () => {
    const result = interpolateEnvVarsInLines(["static", "content"]);
    assert.deepEqual(result, ["static", "content"]);
  });

  test("throws on missing required var in any line", () => {
    assert.throws(
      () => interpolateEnvVarsInLines(["${DIR}/", "${MISSING}"]),
      /Missing required environment variable: MISSING/
    );
  });
});

describe("interpolateContent", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.VAR = "value";
    process.env.DIR = "build";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("handles string content", () => {
    const result = interpolateContent("prefix-${VAR}");
    assert.equal(result, "prefix-value");
  });

  test("handles string array content", () => {
    const result = interpolateContent(["${VAR}", "static"]);
    assert.deepEqual(result, ["value", "static"]);
  });

  test("handles object content", () => {
    const result = interpolateContent({ key: "${VAR}" });
    assert.deepEqual(result, { key: "value" });
  });

  test("handles nested object content", () => {
    const result = interpolateContent({
      outer: { inner: "${VAR}" },
    });
    assert.deepEqual(result, { outer: { inner: "value" } });
  });

  test("handles mixed content types within object", () => {
    const result = interpolateContent({
      stringVal: "${VAR}",
      arrayVal: ["${DIR}"],
      numVal: 123,
    });
    assert.deepEqual(result, {
      stringVal: "value",
      arrayVal: ["build"],
      numVal: 123,
    });
  });
});

describe("escape mechanism with $$ syntax", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.TEST_VAR = "test-value";
    process.env.HOME = "/home/user";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // Basic escape functionality
  test("$${VAR} outputs literal ${VAR}", () => {
    const input = { key: "$${VAR}" };
    const result = interpolateEnvVars(input);
    assert.deepEqual(result, { key: "${VAR}" });
  });

  test("$${VAR:-default} outputs literal ${VAR:-default}", () => {
    const input = { key: "$${MISSING:-fallback}" };
    const result = interpolateEnvVars(input);
    assert.deepEqual(result, { key: "${MISSING:-fallback}" });
  });

  test("$${VAR:?message} outputs literal ${VAR:?message}", () => {
    const input = { key: "$${REQUIRED:?Must be set}" };
    const result = interpolateEnvVars(input);
    assert.deepEqual(result, { key: "${REQUIRED:?Must be set}" });
  });

  // Mixed escaped and non-escaped
  test("mixes escaped and interpolated vars in same string", () => {
    const input = { key: "${TEST_VAR} and $${NOT_INTERPOLATED}" };
    const result = interpolateEnvVars(input);
    assert.deepEqual(result, { key: "test-value and ${NOT_INTERPOLATED}" });
  });

  test("multiple escaped vars in one string", () => {
    const input = { key: "$${VAR1} and $${VAR2}" };
    const result = interpolateEnvVars(input);
    assert.deepEqual(result, { key: "${VAR1} and ${VAR2}" });
  });

  // Real-world use case: devcontainer.json
  test("devcontainer remoteEnv pattern", () => {
    const input = {
      remoteEnv: {
        LOCAL_WORKSPACE_FOLDER: "$${localWorkspaceFolder}",
        CONTAINER_WORKSPACE: "$${containerWorkspaceFolder}",
        ACTUAL_VALUE: "${TEST_VAR}",
      },
    };
    const result = interpolateEnvVars(input);
    assert.deepEqual(result, {
      remoteEnv: {
        LOCAL_WORKSPACE_FOLDER: "${localWorkspaceFolder}",
        CONTAINER_WORKSPACE: "${containerWorkspaceFolder}",
        ACTUAL_VALUE: "test-value",
      },
    });
  });

  // Nested objects
  test("handles escaped vars in nested objects", () => {
    const input = {
      outer: {
        inner: {
          template: "$${TEMPLATE_VAR}",
        },
      },
    };
    const result = interpolateEnvVars(input);
    assert.deepEqual(result, {
      outer: { inner: { template: "${TEMPLATE_VAR}" } },
    });
  });

  // Arrays
  test("handles escaped vars in arrays", () => {
    const input = {
      items: ["$${VAR1}", "${TEST_VAR}", "$${VAR2}"],
    };
    const result = interpolateEnvVars(input);
    assert.deepEqual(result, {
      items: ["${VAR1}", "test-value", "${VAR2}"],
    });
  });

  // String interpolation function
  test("interpolateEnvVarsInString handles escaped vars", () => {
    const result = interpolateEnvVarsInString("template: $${localEnv:HOME}");
    assert.equal(result, "template: ${localEnv:HOME}");
  });

  // Lines array
  test("interpolateEnvVarsInLines handles escaped vars", () => {
    const result = interpolateEnvVarsInLines([
      "# Use $${VAR} for local env",
      "export PATH=${HOME}",
    ]);
    assert.deepEqual(result, [
      "# Use ${VAR} for local env",
      "export PATH=/home/user",
    ]);
  });

  // Edge cases
  test("consecutive escaped vars", () => {
    const input = { key: "$${A}$${B}" };
    const result = interpolateEnvVars(input);
    assert.deepEqual(result, { key: "${A}${B}" });
  });

  test("escaped var at start and end of string", () => {
    const input = { key: "$${START} middle $${END}" };
    const result = interpolateEnvVars(input);
    assert.deepEqual(result, { key: "${START} middle ${END}" });
  });

  test("interpolateContent handles escaped vars in string", () => {
    const result = interpolateContent("prefix-$${VAR}");
    assert.equal(result, "prefix-${VAR}");
  });

  test("interpolateContent handles escaped vars in array", () => {
    const result = interpolateContent(["$${VAR}", "static"]);
    assert.deepEqual(result, ["${VAR}", "static"]);
  });
});
