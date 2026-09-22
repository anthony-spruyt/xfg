import { readFileSync, writeFileSync, globSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { program } from "../../src/cli/program.js";
import {
  applyGeneratedBlocks,
  type BlockRenderer,
} from "./generated-blocks.js";
import { findSubcommand, renderCliOptions } from "./render-cli.js";
import { renderActionInputs } from "./render-action.js";
import {
  renderSchemaBlock,
  schemaBlockIds,
  type JsonSchema,
} from "./render-schema.js";

export const repoRoot = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
  "..",
  ".."
);

export function createRenderer(root = repoRoot): BlockRenderer {
  const schema = JSON.parse(
    readFileSync(join(root, "config-schema.json"), "utf-8")
  ) as JsonSchema;
  const action = readFileSync(join(root, "action.yml"), "utf-8");

  const renderers = new Map<string, () => string>([
    ["cli:sync", () => renderCliOptions(findSubcommand(program, ["sync"]))],
    [
      "cli:secrets-sync",
      () => renderCliOptions(findSubcommand(program, ["secrets", "sync"])),
    ],
    ["action:inputs", () => renderActionInputs(action)],
  ]);

  for (const id of schemaBlockIds(schema)) {
    renderers.set(id, () => renderSchemaBlock(schema, id));
  }

  return (id) => {
    const render = renderers.get(id);
    if (!render) throw new Error(`unknown generated block id '${id}'`);
    return render();
  };
}

export function docFiles(root = repoRoot): string[] {
  return [
    join(root, "README.md"),
    ...globSync("docs/**/*.md", { cwd: root }).map((file) => join(root, file)),
  ].sort();
}

function main(): void {
  const check = process.argv.includes("--check");
  const render = createRenderer();
  const stale: string[] = [];

  for (const file of docFiles()) {
    const content = readFileSync(file, "utf-8");
    let updated: string;
    try {
      updated = applyGeneratedBlocks(content, render);
    } catch (error) {
      throw new Error(
        `${relative(repoRoot, file)}: ${(error as Error).message}`,
        { cause: error }
      );
    }
    if (updated === content) continue;
    stale.push(relative(repoRoot, file));
    if (!check) writeFileSync(file, updated);
  }

  if (stale.length === 0) {
    console.log(check ? "Docs are up to date." : "No changes.");
    return;
  }

  if (check) {
    console.error("Stale generated docs:");
    for (const file of stale) console.error(`  ${file}`);
    console.error("Run `npm run docs:generate` from packages/xfg/.");
    process.exitCode = 1;
    return;
  }

  console.log("Updated:");
  for (const file of stale) console.log(`  ${file}`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
