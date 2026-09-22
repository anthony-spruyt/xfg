import type { Command, Option } from "commander";
import { renderTable, escapeCell } from "./markdown-table.js";

export function findSubcommand(root: Command, path: string[]): Command {
  return path.reduce((cmd, name) => {
    const next = cmd.commands.find((c) => c.name() === name);
    if (!next) throw new Error(`unknown command '${name}'`);
    return next;
  }, root);
}

function renderDefault(option: Option): string {
  if (option.mandatory) return "**Required**";
  if (option.defaultValue !== undefined) {
    return `\`${String(option.defaultValue)}\``;
  }
  const takesValue = option.required || option.optional;
  return takesValue ? "-" : "`false`";
}

export function renderCliOptions(cmd: Command): string {
  const options = cmd.options
    .filter((option) => !option.hidden)
    .sort((a, b) => Number(b.mandatory) - Number(a.mandatory));

  const rows = options.map((option) => [
    option.long ? `\`${option.long}\`` : `\`${option.short}\``,
    option.long && option.short ? `\`${option.short}\`` : "",
    escapeCell(option.description),
    renderDefault(option),
  ]);

  return renderTable(["Option", "Alias", "Description", "Default"], rows);
}
