import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { program } from "../../../src/cli/program.js";
import {
  renderCliOptions,
  findSubcommand,
} from "../../../scripts/docs/render-cli.js";

describe("findSubcommand", () => {
  test("finds a top-level command", () => {
    assert.equal(findSubcommand(program, ["sync"]).name(), "sync");
  });

  test("finds a nested command", () => {
    const cmd = findSubcommand(program, ["secrets", "sync"]);
    assert.equal(cmd.name(), "sync");
    assert.equal(cmd.parent?.name(), "secrets");
  });

  test("throws when the command is missing", () => {
    assert.throws(
      () => findSubcommand(program, ["nope"]),
      /unknown command 'nope'/
    );
  });
});

describe("renderCliOptions", () => {
  const sync = renderCliOptions(findSubcommand(program, ["sync"]));
  const secretsSync = renderCliOptions(
    findSubcommand(program, ["secrets", "sync"])
  );

  test("renders a header row", () => {
    assert.match(
      sync.split("\n")[0],
      /^\| Option\s+\| Alias\s+\| Description\s+\| Default\s+\|$/
    );
  });

  test("lists required options first and marks them required", () => {
    const rows = sync.split("\n").slice(2);
    assert.match(
      rows[0],
      /^\| `--config`\s+\| `-c`\s+\| Path to YAML config file\s+\| \*\*Required\*\*\s+\|$/
    );
  });

  test("renders literal defaults in backticks", () => {
    assert.match(sync, /\| `--retries`\s+\| `-r`\s+\|[^|]+\| `3`\s+\|/);
    assert.match(sync, /\| `--work-dir`\s+\| `-w`\s+\|[^|]+\| `\.\/tmp`\s+\|/);
  });

  test("renders boolean flags as false by default", () => {
    assert.match(sync, /\| `--dry-run`\s+\| `-d`\s+\|[^|]+\| `false`\s+\|/);
    assert.match(sync, /\| `--no-delete`\s+\|\s+\|[^|]+\| `false`\s+\|/);
  });

  test("renders a dash when a value option has no default", () => {
    assert.match(sync, /\| `--branch`\s+\| `-b`\s+\|[^|]+\| -\s+\|/);
  });

  test("escapes pipes inside descriptions", () => {
    for (const row of sync.split("\n")) {
      const unescaped = row.replace(/\\\|/g, "").split("|").length - 1;
      assert.equal(
        unescaped,
        5,
        `row has ${unescaped} cell separators: ${row}`
      );
    }
  });

  test("sync has branch options that secrets sync does not", () => {
    assert.match(sync, /`--merge-strategy`/);
    assert.doesNotMatch(secretsSync, /`--merge-strategy`/);
    assert.doesNotMatch(secretsSync, /`--branch`/);
  });
});
