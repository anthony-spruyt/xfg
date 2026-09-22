import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderSchemaBlock,
  schemaBlockIds,
} from "../../../scripts/docs/render-schema.js";

const repoRoot = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  ".."
);
const schema = JSON.parse(
  readFileSync(join(repoRoot, "config-schema.json"), "utf-8")
) as Record<string, unknown>;

describe("schemaBlockIds", () => {
  test("covers the root and every definition", () => {
    const ids = schemaBlockIds(schema);
    assert.ok(ids.includes("schema:root"));
    assert.ok(ids.includes("schema:prOptions"));
    assert.ok(ids.includes("schema:rulesetRule"));
    assert.equal(
      ids.length,
      1 + Object.keys(schema.definitions as object).length
    );
  });
});

describe("renderSchemaBlock", () => {
  test("renders the root properties", () => {
    const table = renderSchemaBlock(schema, "schema:root");
    assert.match(
      table.split("\n")[0],
      /^\| Field\s+\| Type\s+\| Required\s+\| Default\s+\| Description\s+\|$/
    );
    assert.match(table, /\| `id`\s+\| `string`\s+\| No\s+/);
    assert.match(table, /\| `prTemplate`\s+\| `string`\s+\| No\s+/);
  });

  test("marks required fields from the definition's required list", () => {
    const table = renderSchemaBlock(schema, "schema:secretConfig");
    assert.match(table, /\| `env`\s+\|[^|]+\| Yes\s+/);
  });

  test("links \\$ref types to their definition heading", () => {
    const table = renderSchemaBlock(schema, "schema:root");
    assert.match(table, /\| `prOptions`\s+\| \[`prOptions`\]\(#proptions\)\s+/);
  });

  test("renders arrays with a [] suffix", () => {
    const table = renderSchemaBlock(schema, "schema:root");
    assert.match(table, /\| `repos`\s+\| \[`repo`\]\(#repo\)\[\]\s+/);
  });

  test("renders enums as alternatives and shows defaults", () => {
    const table = renderSchemaBlock(schema, "schema:prOptions");
    const merge = table.split("\n").find((row) => row.startsWith("| `merge`"));
    assert.ok(merge, "expected a merge row");
    for (const value of ["manual", "auto", "force", "direct"]) {
      assert.ok(merge.includes(`\`${value}\``), `missing ${value}`);
    }
    assert.match(merge, /\| `auto`\s+\|/);
  });

  test("renders a oneOf definition as a list of members", () => {
    const block = renderSchemaBlock(schema, "schema:rulesetRule");
    assert.match(block, /^One of:$/m);
    assert.match(block, /^- \[`pullRequestRule`\]\(#pullrequestrule\)$/m);
  });

  test("renders const values", () => {
    const table = renderSchemaBlock(schema, "schema:pullRequestRule");
    assert.match(table, /\| `type`\s+\| `pull_request`\s+/);
  });

  test("every block id renders a non-empty block with balanced cells", () => {
    for (const id of schemaBlockIds(schema)) {
      const block = renderSchemaBlock(schema, id);
      assert.ok(block.trim().length > 0, `${id} rendered empty`);
      for (const row of block.split("\n")) {
        if (!row.startsWith("|")) continue;
        const cells = row.replace(/\\\|/g, "").split("|").length - 1;
        assert.equal(cells, 6, `${id}: unbalanced row ${row}`);
      }
    }
  });

  test("throws on an unknown id", () => {
    assert.throws(
      () => renderSchemaBlock(schema, "schema:nope"),
      /unknown schema definition 'nope'/
    );
  });
});
