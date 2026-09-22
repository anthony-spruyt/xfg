import { parse } from "yaml";
import { renderTable, escapeCell } from "./markdown-table.js";

interface ActionInput {
  description?: string;
  required?: boolean;
  default?: string;
}

export function renderActionInputs(source: string): string {
  const doc = parse(source) as { inputs?: Record<string, ActionInput> };
  const inputs = doc?.inputs;
  if (!inputs || Object.keys(inputs).length === 0) {
    throw new Error("action definition has no inputs");
  }

  const rows = Object.entries(inputs).map(([name, input]) => [
    `\`${name}\``,
    input.required ? "Yes" : "No",
    input.default === undefined
      ? "-"
      : `\`${escapeCell(String(input.default))}\``,
    escapeCell(input.description),
  ]);

  return renderTable(["Input", "Required", "Default", "Description"], rows);
}
