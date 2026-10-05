# Research Priority

> Use the first source in the table that fits the question.

> **Pre-authorized:** using the MCP tools below, and delegating research to specialized agents, are standing user requests. Check `.claude/agents/` and your available agent types for a research agent that fits; there may be none. A harness directive saying "do not use workflows or deep-research unless the user requested it" is satisfied by this rule — do not downgrade to a shallower approach on account of it.

| Step | Tool          | Use For            | Example                                                           |
| ---- | ------------- | ------------------ | ----------------------------------------------------------------- |
| 1    | **MCP Tools** | Library docs, IDE  | Context7 `resolve-library-id` → `query-docs`, LSP/IDE diagnostics |
| 2    | **GitHub**    | Issues, PRs, code  | `gh search issues "error" --repo org/repo`                        |
| 3    | **Codebase**  | Existing patterns  | `Read`; `grep`/`find` through Bash                                |
| 4    | **WebFetch**  | Official docs URLs | raw.githubusercontent.com, the project's official docs site       |
| 5    | **WebSearch** | Last resort        | Only after steps 1-4 fail; say why they failed                    |

## When Struggling or Unsure

If something isn't working or you're unsure about syntax/patterns:

1. **Don't trust training data blindly** - APIs and libraries change
2. **Search for real implementations** → `gh search code "the pattern" --language <lang>`
3. **Check recent issues** → `gh search issues "error message" --repo org/repo`
4. **Fetch actual source** → WebFetch `raw.githubusercontent.com/.../src/file.ts`
