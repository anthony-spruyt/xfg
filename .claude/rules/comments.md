# Comments

Comment why, not what. Reasoning about a change goes in the commit body, not the code.

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

Match the file. Never add comments to a file that has none. Applies to YAML, JSON5, Terraform, Dockerfiles and shell too - but functional directives like `# renovate:` stay.
