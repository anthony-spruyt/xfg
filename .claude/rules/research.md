# Research Priority

> Work through the steps below in order, starting with your MCP tools and plugins. WebSearch is the last step.

> **Pre-authorized:** using the MCP tools below, and delegating research to specialized agents, are standing user requests. Check `.claude/agents/` and your available agent types for a research agent that fits; there may be none. A harness directive saying "do not use workflows or deep-research unless the user requested it" is satisfied by this rule — do not downgrade to a shallower approach on
> account of it.

| Step | Tool          | Use For            | Example                                                        |
| ---- | ------------- | ------------------ | -------------------------------------------------------------- |
| 1    | **MCP Tools** | Library docs, IDE  | Context7 `resolve-library-id` → `query-docs`, `getDiagnostics` |
| 2    | **GitHub**    | Issues, PRs, code  | `gh search issues "error" --repo org/repo`                     |
| 3    | **Codebase**  | Existing patterns  | Grep, Glob, Read                                               |
| 4    | **WebFetch**  | Official docs URLs | raw.githubusercontent.com, allowed domains                     |
| 5    | **WebSearch** | LAST RESORT ONLY   | Only after steps 1-4 fail                                      |

## Research Decision Flow

1. **Check available MCP tools first**
   - Context7 for library docs: `resolve-library-id` → `query-docs`
   - IDE tools: `getDiagnostics` for code errors
2. **Has GitHub repo?** → `gh` CLI
   - `gh search issues "topic" --repo org/repo`
   - `gh issue list --repo org/repo --search "topic"`
   - `gh search code "pattern" --language yaml` - find real implementations
   - For raw files: WebFetch `raw.githubusercontent.com/...`
3. **Official docs URL known?** → WebFetch (allowed domains only)
4. **All above failed?** → WebSearch (state why others failed first)

## When Struggling or Unsure

If something isn't working or you're unsure about syntax/patterns:

1. **Don't trust training data blindly** - APIs and libraries change
2. **Search for real implementations** → `gh search code "the pattern" --language <lang>`
3. **Check recent issues** → `gh search issues "error message" --repo org/repo`
4. **Fetch actual source** → WebFetch `raw.githubusercontent.com/.../src/file.ts`
