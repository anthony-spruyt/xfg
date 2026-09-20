# Comments

The default is no comment. Comment why, not what. Reasoning about a change goes in the commit body, not the code.

## Never comment

- Narration of your edit: `// Added retry logic`, `# Now loop over users`
- Restatement of the line below it: `// increment counter`
- Changelog or history: `// Was 30s`, `// Fixed bug where...`
- Attribution: `// Claude generated`, `// per user request`
- Commented-out code - delete it, git remembers

## Comment only for

- Footguns: `// Must run before init() - reads the env var it sets`
- Non-obvious constraints: `// Batch size caps at 10 - API rate limit`
- Counter-intuitive choices: `// Sequential - endpoint 409s on concurrent writes`
- Workarounds: link the upstream issue and the removal condition

## Length

One line. Two if the footgun genuinely needs them. A comment that wants a paragraph is not a comment - it belongs in the commit body or a README.

## Delete comment debt you find

When you touch a file, delete any comment in it that this rule forbids - narration, restatement, changelog, attribution, commented-out code. Do not leave it because someone else wrote it. Do not ask first. Remove it in the same commit and say so in the body.

Functional directives are not comments and stay: `# renovate:`, `//go:generate`, `# yamllint disable`, `# nolint`, license headers.
