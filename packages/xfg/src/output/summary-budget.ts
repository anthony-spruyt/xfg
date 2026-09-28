import { appendDiffBlock, diffFence } from "../shared/markdown-fence.js";

export interface SummaryBlock {
  heading?: string;
  diffLines: string[];
}

export interface SummaryParts {
  header: string[];
  blocks: SummaryBlock[];
  footer: string;
}

const CUT_NOTE = "... cut to fit GitHub's 1 MiB summary limit";
// Room kept for the "more repos not shown" line.
const NOTE_RESERVE_BYTES = 100;

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

function cutToFit(diffLines: string[], room: number): string[] {
  const kept: string[] = [];
  let used = lineBytes(CUT_NOTE);
  for (const line of diffLines) {
    used += lineBytes(line);
    if (used > room) break;
    kept.push(line);
  }
  if (kept.length > 0) kept.push(CUT_NOTE);
  return kept;
}

// Priority: footer, then header, then whole blocks, then cut blocks with what is left.
export function fitSummary(parts: SummaryParts, maxBytes: number): string {
  let used = lineBytes(parts.footer);
  if (used > maxBytes) return "";

  const lines: string[] = [];
  const headerBytes = linesBytes(parts.header);
  if (used + headerBytes <= maxBytes) {
    for (const line of parts.header) lines.push(line);
    used += headerBytes;
  }

  const room = () => maxBytes - used - NOTE_RESERVE_BYTES;
  const shown: (string[] | undefined)[] = [];
  const overheads: number[] = [];

  parts.blocks.forEach((block, i) => {
    overheads[i] = blockOverhead(block);
    const bytes = overheads[i] + linesBytes(block.diffLines);
    if (bytes <= room()) {
      shown[i] = block.diffLines;
      used += bytes;
    }
  });

  parts.blocks.forEach((block, i) => {
    if (shown[i]) return;
    const kept = cutToFit(block.diffLines, room() - overheads[i]);
    if (kept.length === 0) return;
    shown[i] = kept;
    used += overheads[i] + linesBytes(kept);
  });

  let hidden = 0;
  parts.blocks.forEach((block, i) => {
    const diffLines = shown[i];
    if (!diffLines) {
      hidden++;
      return;
    }
    if (block.heading !== undefined) lines.push(block.heading, "");
    appendDiffBlock(lines, diffLines);
  });

  if (hidden > 0 && maxBytes - used >= NOTE_RESERVE_BYTES) {
    lines.push(
      `_... ${hidden} more ${hidden === 1 ? "repo" : "repos"} not shown. See the job log._`,
      ""
    );
  }

  lines.push(parts.footer);
  return lines.join("\n");
}
