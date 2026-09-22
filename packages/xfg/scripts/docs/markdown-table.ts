const MIN_WIDTH = 3;

const BARE_URL = /(?<![`\w])((?:https?:\/\/|git@)[^\s,)'"]*[^\s,.)'"])/g;

export function escapeCell(text: string | undefined): string {
  if (!text) return "";
  return text
    .replace(BARE_URL, "`$1`")
    .replace(/[\\|<]/g, (char) => `\\${char}`)
    .replace(/\s+/g, " ")
    .trim();
}

export function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, column) =>
    Math.max(
      MIN_WIDTH,
      header.length,
      ...rows.map((row) => (row[column] ?? "").length)
    )
  );

  const line = (cells: string[]): string =>
    `| ${widths.map((width, i) => (cells[i] ?? "").padEnd(width)).join(" | ")} |`;

  return [
    line(headers),
    line(widths.map((width) => "-".repeat(width))),
    ...rows.map(line),
  ].join("\n");
}
