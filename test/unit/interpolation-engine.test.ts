import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  interpolateString,
  interpolateValue,
  type InterpolationConfig,
} from "../../src/shared/interpolation-engine.js";

function createTestConfig(vars: Record<string, string>): InterpolationConfig {
  return {
    escapeRegex: /\$\$\{([^}]+)\}/g,
    escapePlaceholder: "__ESCAPED__",
    applyInterpolation: (value: string) =>
      value.replace(/\$\{([^}]+)\}/g, (_m, key: string) => vars[key] ?? ""),
    restoreEscaped: (content: string) => `\${${content}}`,
  };
}

describe("interpolateString", () => {
  test("interpolates variables", () => {
    const config = createTestConfig({ NAME: "world" });
    assert.equal(interpolateString("hello ${NAME}", config), "hello world");
  });

  test("preserves escaped sequences", () => {
    const config = createTestConfig({ NAME: "world" });
    assert.equal(
      interpolateString("literal $${NAME}", config),
      "literal ${NAME}"
    );
  });

  test("handles mixed escaped and unescaped", () => {
    const config = createTestConfig({ A: "1", B: "2" });
    assert.equal(interpolateString("${A} $${B} ${B}", config), "1 ${B} 2");
  });

  test("returns unchanged string with no patterns", () => {
    const config = createTestConfig({});
    assert.equal(interpolateString("plain text", config), "plain text");
  });
});

describe("interpolateValue", () => {
  test("interpolates strings", () => {
    const config = createTestConfig({ X: "val" });
    assert.equal(interpolateValue("${X}", config), "val");
  });

  test("recursively processes arrays", () => {
    const config = createTestConfig({ X: "val" });
    assert.deepEqual(interpolateValue(["${X}", "plain"], config), [
      "val",
      "plain",
    ]);
  });

  test("recursively processes objects", () => {
    const config = createTestConfig({ X: "val" });
    assert.deepEqual(interpolateValue({ key: "${X}" }, config), {
      key: "val",
    });
  });

  test("passes through non-string primitives", () => {
    const config = createTestConfig({});
    assert.equal(interpolateValue(42, config), 42);
    assert.equal(interpolateValue(true, config), true);
    assert.equal(interpolateValue(null, config), null);
  });
});
