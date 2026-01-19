import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  detectOutputFormat,
  convertContentToString,
  type OutputFormat,
} from "./config-formatter.js";

describe("detectOutputFormat", () => {
  test("returns json for .json extension", () => {
    const result = detectOutputFormat("config.json");
    assert.equal(result, "json");
  });

  test("returns yaml for .yaml extension", () => {
    const result = detectOutputFormat("config.yaml");
    assert.equal(result, "yaml");
  });

  test("returns yaml for .yml extension", () => {
    const result = detectOutputFormat("config.yml");
    assert.equal(result, "yml" === "yml" ? "yaml" : "json");
  });

  test("handles uppercase extensions", () => {
    assert.equal(detectOutputFormat("config.JSON"), "json");
    assert.equal(detectOutputFormat("config.YAML"), "yaml");
    assert.equal(detectOutputFormat("config.YML"), "yaml");
  });

  test("handles mixed case extensions", () => {
    assert.equal(detectOutputFormat("config.Json"), "json");
    assert.equal(detectOutputFormat("config.Yaml"), "yaml");
  });

  test("handles multiple dots in filename", () => {
    assert.equal(detectOutputFormat("my.config.json"), "json");
    assert.equal(detectOutputFormat("my.config.yaml"), "yaml");
    assert.equal(detectOutputFormat("my.config.file.yml"), "yaml");
  });

  test("returns json for unknown extensions", () => {
    assert.equal(detectOutputFormat("config.txt"), "json");
    assert.equal(detectOutputFormat("config.xml"), "json");
  });

  test("returns json for no extension", () => {
    assert.equal(detectOutputFormat("config"), "json");
  });

  test("handles path with directories", () => {
    assert.equal(detectOutputFormat("path/to/config.json"), "json");
    assert.equal(detectOutputFormat("path/to/config.yaml"), "yaml");
  });

  test("returns json5 for .json5 extension", () => {
    assert.equal(detectOutputFormat("config.json5"), "json5");
  });

  test("handles uppercase .JSON5 extension", () => {
    assert.equal(detectOutputFormat("config.JSON5"), "json5");
  });

  test("handles path with .json5 extension", () => {
    assert.equal(detectOutputFormat("path/to/config.json5"), "json5");
  });
});

describe("convertContentToString", () => {
  test("converts to JSON with 2-space indent for .json files", () => {
    const content = { key: "value", nested: { a: 1 } };
    const result = convertContentToString(content, "config.json");

    // Should be valid JSON
    const parsed = JSON.parse(result);
    assert.deepEqual(parsed, content);

    // Should have 2-space indentation
    assert.ok(result.includes('  "key"'));
  });

  test("converts to YAML with 2-space indent for .yaml files", () => {
    const content = { key: "value", nested: { a: 1 } };
    const result = convertContentToString(content, "config.yaml");

    // Should contain YAML format (no quotes around simple strings, colons)
    assert.ok(result.includes("key: value"));
    assert.ok(result.includes("nested:"));
    assert.ok(result.includes("  a: 1"));
  });

  test("converts to YAML for .yml files", () => {
    const content = { key: "value" };
    const result = convertContentToString(content, "config.yml");
    assert.ok(result.includes("key: value"));
  });

  test("handles arrays in JSON format", () => {
    const content = { items: ["a", "b", "c"] };
    const result = convertContentToString(content, "config.json");
    const parsed = JSON.parse(result);
    assert.deepEqual(parsed.items, ["a", "b", "c"]);
  });

  test("handles arrays in YAML format", () => {
    const content = { items: ["a", "b", "c"] };
    const result = convertContentToString(content, "config.yaml");
    assert.ok(result.includes("- a"));
    assert.ok(result.includes("- b"));
    assert.ok(result.includes("- c"));
  });

  test("handles empty object", () => {
    const content = {};
    const jsonResult = convertContentToString(content, "config.json");
    const yamlResult = convertContentToString(content, "config.yaml");

    assert.equal(JSON.parse(jsonResult).toString(), {}.toString());
    assert.ok(yamlResult === "{}\n" || yamlResult.trim() === "{}");
  });

  test("handles nested objects", () => {
    const content = {
      level1: {
        level2: {
          level3: "deep",
        },
      },
    };

    const jsonResult = convertContentToString(content, "config.json");
    const parsed = JSON.parse(jsonResult);
    assert.equal(parsed.level1.level2.level3, "deep");

    const yamlResult = convertContentToString(content, "config.yaml");
    assert.ok(yamlResult.includes("level1:"));
    assert.ok(yamlResult.includes("level2:"));
    assert.ok(yamlResult.includes("level3: deep"));
  });

  test("handles special characters in JSON", () => {
    const content = { message: 'Hello "World"' };
    const result = convertContentToString(content, "config.json");
    const parsed = JSON.parse(result);
    assert.equal(parsed.message, 'Hello "World"');
  });

  test("handles boolean and number values", () => {
    const content = { enabled: true, count: 42, ratio: 3.14 };

    const jsonResult = convertContentToString(content, "config.json");
    const parsed = JSON.parse(jsonResult);
    assert.equal(parsed.enabled, true);
    assert.equal(parsed.count, 42);
    assert.equal(parsed.ratio, 3.14);

    const yamlResult = convertContentToString(content, "config.yaml");
    assert.ok(yamlResult.includes("enabled: true"));
    assert.ok(yamlResult.includes("count: 42"));
  });

  test("handles null values", () => {
    const content = { empty: null };

    const jsonResult = convertContentToString(content, "config.json");
    const parsed = JSON.parse(jsonResult);
    assert.equal(parsed.empty, null);

    const yamlResult = convertContentToString(content, "config.yaml");
    assert.ok(
      yamlResult.includes("empty: null") || yamlResult.includes("empty:"),
    );
  });
});

describe("convertContentToString with empty files", () => {
  test("null content returns empty string for JSON", () => {
    const result = convertContentToString(null, "config.json");
    assert.equal(result, "");
  });

  test("null content returns empty string for YAML", () => {
    const result = convertContentToString(null, "config.yaml");
    assert.equal(result, "");
  });

  test("null content with schemaUrl returns comment for YAML", () => {
    const result = convertContentToString(null, "config.yaml", {
      schemaUrl: "https://example.com/schema.json",
    });
    assert.ok(
      result.includes(
        "# yaml-language-server: $schema=https://example.com/schema.json",
      ),
    );
  });

  test("null content with header returns comments for YAML", () => {
    const result = convertContentToString(null, "config.yaml", {
      header: ["This is a header comment"],
    });
    assert.ok(result.includes("# This is a header comment"));
  });

  test("null content with schemaUrl is ignored for JSON", () => {
    const result = convertContentToString(null, "config.json", {
      schemaUrl: "https://example.com/schema.json",
    });
    assert.equal(result, "");
  });
});

describe("convertContentToString with YAML header comments", () => {
  test("schemaUrl adds yaml-language-server directive", () => {
    const content = { key: "value" };
    const result = convertContentToString(content, "config.yaml", {
      schemaUrl: "https://example.com/schema.json",
    });
    assert.ok(
      result.includes(
        "# yaml-language-server: $schema=https://example.com/schema.json",
      ),
    );
    assert.ok(result.includes("key: value"));
  });

  test("header adds comment lines", () => {
    const content = { key: "value" };
    const result = convertContentToString(content, "config.yaml", {
      header: ["This is a comment"],
    });
    assert.ok(result.includes("# This is a comment"));
    assert.ok(result.includes("key: value"));
  });

  test("multi-line header works correctly", () => {
    const content = { key: "value" };
    const result = convertContentToString(content, "config.yaml", {
      header: ["Line 1", "Line 2"],
    });
    assert.ok(result.includes("# Line 1"));
    assert.ok(result.includes("# Line 2"));
  });

  test("schemaUrl appears before header", () => {
    const content = { key: "value" };
    const result = convertContentToString(content, "config.yaml", {
      schemaUrl: "https://example.com/schema.json",
      header: ["Custom comment"],
    });
    const schemaIndex = result.indexOf("yaml-language-server");
    const headerIndex = result.indexOf("Custom comment");
    assert.ok(
      schemaIndex < headerIndex,
      "Schema URL should appear before header",
    );
  });

  test("header and schemaUrl combined", () => {
    const content = { key: "value" };
    const result = convertContentToString(content, "config.yaml", {
      schemaUrl: "https://example.com/schema.json",
      header: ["Custom comment"],
    });
    assert.ok(
      result.includes(
        "# yaml-language-server: $schema=https://example.com/schema.json",
      ),
    );
    assert.ok(result.includes("# Custom comment"));
    assert.ok(result.includes("key: value"));
  });
});

describe("convertContentToString with JSON5 format", () => {
  test("converts to JSON5 with 2-space indent for .json5 files", () => {
    const content = { key: "value", nested: { a: 1 } };
    const result = convertContentToString(content, "config.json5");

    // Should be valid JSON (JSON5.stringify outputs valid JSON by default)
    const parsed = JSON.parse(result);
    assert.deepEqual(parsed, content);

    // Should have 2-space indentation
    assert.ok(result.includes('  "key"'));
  });

  test("handles arrays in JSON5 format", () => {
    const content = { items: ["a", "b", "c"] };
    const result = convertContentToString(content, "config.json5");
    const parsed = JSON.parse(result);
    assert.deepEqual(parsed.items, ["a", "b", "c"]);
  });

  test("handles nested objects in JSON5 format", () => {
    const content = {
      level1: {
        level2: {
          level3: "deep",
        },
      },
    };
    const result = convertContentToString(content, "config.json5");
    const parsed = JSON.parse(result);
    assert.equal(parsed.level1.level2.level3, "deep");
  });

  test("null content returns empty string for JSON5", () => {
    const result = convertContentToString(null, "config.json5");
    assert.equal(result, "");
  });

  test("header and schemaUrl are ignored for JSON5 files", () => {
    const content = { key: "value" };
    const result = convertContentToString(content, "config.json5", {
      header: ["This is a comment"],
      schemaUrl: "https://example.com/schema.json",
    });
    assert.ok(!result.includes("comment"));
    assert.ok(!result.includes("schema"));
    assert.ok(result.includes('"key"'));
  });
});

describe("convertContentToString JSON ignores comments", () => {
  test("header is ignored for JSON files", () => {
    const content = { key: "value" };
    const result = convertContentToString(content, "config.json", {
      header: ["This is a comment"],
    });
    assert.ok(!result.includes("comment"));
    assert.ok(result.includes('"key"'));
  });

  test("schemaUrl is ignored for JSON files", () => {
    const content = { key: "value" };
    const result = convertContentToString(content, "config.json", {
      schemaUrl: "https://example.com/schema.json",
    });
    assert.ok(!result.includes("schema"));
    assert.ok(result.includes('"key"'));
  });
});

describe("convertContentToString with text content", () => {
  describe("string content", () => {
    test("outputs string with trailing newline", () => {
      const result = convertContentToString("line1\nline2", ".gitignore");
      assert.equal(result, "line1\nline2\n");
    });

    test("preserves existing trailing newline", () => {
      const result = convertContentToString(
        "line1\nline2\n",
        ".markdownlintignore",
      );
      assert.equal(result, "line1\nline2\n");
    });

    test("handles single line", () => {
      const result = convertContentToString("node_modules/", ".gitignore");
      assert.equal(result, "node_modules/\n");
    });

    test("handles empty string", () => {
      const result = convertContentToString("", ".gitignore");
      assert.equal(result, "\n");
    });

    test("ignores header option for text files", () => {
      const result = convertContentToString("content", ".gitignore", {
        header: ["ignored"],
      });
      assert.equal(result, "content\n");
      assert.ok(!result.includes("ignored"));
    });

    test("ignores schemaUrl option for text files", () => {
      const result = convertContentToString("content", ".gitignore", {
        schemaUrl: "https://example.com/schema.json",
      });
      assert.equal(result, "content\n");
      assert.ok(!result.includes("schema"));
    });
  });

  describe("string array content", () => {
    test("joins lines with newlines", () => {
      const result = convertContentToString(
        ["line1", "line2", "line3"],
        ".gitignore",
      );
      assert.equal(result, "line1\nline2\nline3\n");
    });

    test("handles single line array", () => {
      const result = convertContentToString(["only-line"], ".gitignore");
      assert.equal(result, "only-line\n");
    });

    test("handles empty array", () => {
      const result = convertContentToString([], ".gitignore");
      assert.equal(result, "");
    });

    test("ignores header option for text files", () => {
      const result = convertContentToString(["content"], ".gitignore", {
        header: ["ignored"],
      });
      assert.equal(result, "content\n");
      assert.ok(!result.includes("ignored"));
    });

    test("ignores schemaUrl option for text files", () => {
      const result = convertContentToString(["content"], ".gitignore", {
        schemaUrl: "https://example.com/schema.json",
      });
      assert.equal(result, "content\n");
      assert.ok(!result.includes("schema"));
    });
  });

  describe("various text file extensions", () => {
    test("handles .gitignore", () => {
      const result = convertContentToString("node_modules/", ".gitignore");
      assert.equal(result, "node_modules/\n");
    });

    test("handles .markdownlintignore", () => {
      const result = convertContentToString(".claude/", ".markdownlintignore");
      assert.equal(result, ".claude/\n");
    });

    test("handles .env.example", () => {
      const result = convertContentToString(
        "API_KEY=your-key-here",
        ".env.example",
      );
      assert.equal(result, "API_KEY=your-key-here\n");
    });

    test("handles .prettierignore", () => {
      const result = convertContentToString(
        ["dist/", "coverage/"],
        ".prettierignore",
      );
      assert.equal(result, "dist/\ncoverage/\n");
    });
  });
});
