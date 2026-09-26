const START = /^<!-- xfg:generated (\S+) -->$/;
const END = /^<!-- xfg:generated:end -->$/;

export type BlockRenderer = (id: string) => string;

export function applyGeneratedBlocks(
  doc: string,
  render: BlockRenderer
): string {
  const lines = doc.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const start = START.exec(line);

    if (!start) {
      if (END.test(line)) {
        throw new Error(`end marker without a start at line ${i + 1}`);
      }
      out.push(line);
      i++;
      continue;
    }

    const id = start[1];
    let end = i + 1;
    while (end < lines.length && !END.test(lines[end])) end++;
    if (end >= lines.length) {
      throw new Error(`unterminated generated block '${id}'`);
    }

    out.push(line, "", render(id).replace(/^\n+|\n+$/g, ""), "", lines[end]);
    i = end + 1;
  }

  return out.join("\n");
}

export function findGeneratedBlockIds(doc: string): string[] {
  const ids: string[] = [];
  for (const line of doc.split("\n")) {
    const match = START.exec(line);
    if (match) ids.push(match[1]);
  }
  return ids;
}
