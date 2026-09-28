function longestBacktickRun(text: string): number {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) {
    longest = Math.max(longest, run.length);
  }
  return longest;
}

// Fences must outrun any backtick run inside, or content like ``` closes them early.
export function appendDiffBlock(lines: string[], diffLines: string[]): void {
  if (diffLines.length === 0) return;
  let longest = 0;
  for (const line of diffLines) {
    longest = Math.max(longest, longestBacktickRun(line));
  }
  const fence = "`".repeat(Math.max(3, longest + 1));
  lines.push(`${fence}diff`);
  // Loop, not push(...diffLines) - spreading huge diffs overflows the call stack.
  for (const line of diffLines) lines.push(line);
  lines.push(fence, "");
}

export function inlineCode(text: string): string {
  const fence = "`".repeat(longestBacktickRun(text) + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}
