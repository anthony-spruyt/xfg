// A fence must be longer than any backtick run inside, or content like ``` closes it early.
export function fencedCodeBlock(language: string, lines: string[]): string[] {
  let longestRun = 0;
  for (const line of lines) {
    for (const run of line.match(/`+/g) ?? []) {
      longestRun = Math.max(longestRun, run.length);
    }
  }
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return [`${fence}${language}`, ...lines, fence];
}
