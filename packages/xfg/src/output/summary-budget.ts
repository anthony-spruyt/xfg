import {
  appendDiffBlock,
  diffFence,
  inlineCode,
} from "../shared/markdown-fence.js";

export interface SummaryBlock {
  heading?: string;
  diffLines: string[];
  // Named in the "not shown" note when the block does not fit.
  repos: string[];
}

export interface SummaryParts {
  header: string[];
  blocks: SummaryBlock[];
  footer: string;
}

const CUT_NOTE = "... cut to fit GitHub's 1 MiB summary limit";
// Room kept for the "more repos not shown" line when something is cut.
const NOTE_RESERVE_BYTES = 1000;
// Shorter leftovers of a cut line are not worth showing.
const MIN_CUT_LINE_BYTES = 40;

export function summaryHeader(
  dryRun: boolean,
  title = dryRun ? "## xfg Plan" : "## xfg Apply"
): string[] {
  const lines = [title, ""];
  if (dryRun) {
    lines.push(
      "> [!WARNING]",
      "> This was a dry run — no changes were applied",
      ""
    );
  }
  return lines;
}

function lineBytes(line: string): number {
  return Buffer.byteLength(line) + 1;
}

function linesBytes(lines: string[]): number {
  let total = 0;
  for (const line of lines) total += lineBytes(line);
  return total;
}

function blockOverhead(block: SummaryBlock): number {
  const heading =
    block.heading === undefined ? 0 : lineBytes(block.heading) + 1;
  if (block.diffLines.length === 0) return heading;
  const fence = diffFence(block.diffLines).length;
  return heading + fence + 5 + fence + 1 + 1;
}

function truncateBytes(text: string, maxBytes: number): string {
  const buf = Buffer.from(text);
  if (buf.length <= maxBytes) return text;
  let end = Math.max(0, maxBytes);
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString();
}

function cutToFit(diffLines: string[], room: number): string[] {
  const kept: string[] = [];
  let used = lineBytes(CUT_NOTE);
  for (const line of diffLines) {
    const left = room - used;
    if (lineBytes(line) > left) {
      const part = truncateBytes(line, left - 1 - Buffer.byteLength("…"));
      if (Buffer.byteLength(part) >= MIN_CUT_LINE_BYTES) kept.push(part + "…");
      break;
    }
    kept.push(line);
    used += lineBytes(line);
  }
  if (kept.length > 0) kept.push(CUT_NOTE);
  return kept;
}

function hiddenNote(repos: string[], maxBytes: number): string {
  const prefix = `_${repos.length} more ${repos.length === 1 ? "repo" : "repos"} not shown, see the job log:_`;
  const more = ", …";
  let note = prefix;
  for (let i = 0; i < repos.length; i++) {
    const name = `${i === 0 ? " " : ", "}${inlineCode(repos[i])}`;
    const tail = i < repos.length - 1 ? Buffer.byteLength(more) : 0;
    if (Buffer.byteLength(note + name) + tail > maxBytes) {
      return i === 0 ? prefix : note + more;
    }
    note += name;
  }
  return note;
}

// Priority: footer, then header, then whole blocks, then cut blocks with what is left.
export function fitSummary(parts: SummaryParts, maxBytes: number): string {
  let used = Buffer.byteLength(parts.footer);
  if (used > maxBytes) return "";

  const lines: string[] = [];
  const headerBytes = linesBytes(parts.header);
  if (used + headerBytes <= maxBytes) {
    for (const line of parts.header) lines.push(line);
    used += headerBytes;
  }

  const overheads = parts.blocks.map(blockOverhead);
  const sizes = parts.blocks.map(
    (block, i) => overheads[i] + linesBytes(block.diffLines)
  );
  const allFit = used + sizes.reduce((a, b) => a + b, 0) <= maxBytes;
  const reserve = allFit
    ? 0
    : Math.min(NOTE_RESERVE_BYTES, Math.floor((maxBytes - used) / 2));
  const room = () => maxBytes - used - reserve;
  const shown: (string[] | undefined)[] = [];

  parts.blocks.forEach((block, i) => {
    if (sizes[i] <= room()) {
      shown[i] = block.diffLines;
      used += sizes[i];
    }
  });

  parts.blocks.forEach((block, i) => {
    if (shown[i]) return;
    const kept = cutToFit(block.diffLines, room() - overheads[i]);
    if (kept.length === 0) return;
    shown[i] = kept;
    used += overheads[i] + linesBytes(kept);
  });

  const hidden: string[] = [];
  parts.blocks.forEach((block, i) => {
    const diffLines = shown[i];
    if (!diffLines) {
      for (const repo of block.repos) hidden.push(repo);
      return;
    }
    if (block.heading !== undefined) lines.push(block.heading, "");
    appendDiffBlock(lines, diffLines);
  });

  if (hidden.length > 0) {
    const note = hiddenNote(hidden, maxBytes - used - 2);
    if (lineBytes(note) + 1 <= maxBytes - used) lines.push(note, "");
  }

  lines.push(parts.footer);
  return lines.join("\n");
}
