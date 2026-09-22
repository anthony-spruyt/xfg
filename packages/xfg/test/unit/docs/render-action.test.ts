import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { renderActionInputs } from "../../../scripts/docs/render-action.js";

const yaml = `
inputs:
  config:
    description: "Path to YAML config file"
    required: true
  merge:
    description: "PR merge mode (manual/auto/force/direct)"
    required: false
  github-token:
    description: "GitHub token"
    required: false
    default: \${{ github.token }}
  retries:
    description: "Number of network retries"
    required: false
    default: "3"
`;

describe("renderActionInputs", () => {
  const table = renderActionInputs(yaml);
  const rows = table.split("\n");

  test("renders the header", () => {
    assert.match(
      rows[0],
      /^\| Input\s+\| Required\s+\| Default\s+\| Description\s+\|$/
    );
  });

  test("keeps file order", () => {
    assert.match(rows[2], /^\| `config`\s+\| Yes\s+/);
    assert.match(rows[3], /^\| `merge`\s+\| No\s+/);
  });

  test("marks required inputs", () => {
    assert.match(rows[2], /\| Yes\s+\| -\s+\| Path to YAML config file\s+\|/);
  });

  test("preserves expression defaults verbatim in backticks", () => {
    assert.match(
      table,
      /\| `github-token`\s+\| No\s+\| `\$\{\{ github\.token \}\}`\s+\|/
    );
  });

  test("renders string defaults in backticks", () => {
    assert.match(table, /\| `retries`\s+\| No\s+\| `3`\s+\|/);
  });

  test("throws when the document has no inputs", () => {
    assert.throws(() => renderActionInputs("name: x\n"), /no inputs/);
  });
});
