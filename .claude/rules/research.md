# Research Priority

> **NEVER skip steps. NEVER use WebSearch before exhausting other options.**
> **USE YOUR MCP TOOLS** - Check what tools/plugins are available before falling back to web search.

| Step | Tool          | Use For            | Example                                                        |
| ---- | ------------- | ------------------ | -------------------------------------------------------------- |
| 1    | **MCP Tools** | Library docs, IDE  | Context7 `resolve-library-id` → `query-docs`, `getDiagnostics` |
| 2    | **GitHub**    | Issues, PRs, code  | `gh search issues "error" --repo org/repo`                     |
| 3    | **Codebase**  | Existing patterns  | Grep, Glob, Read                                               |
| 4    | **WebFetch**  | Official docs URLs | raw.githubusercontent.com, allowed domains                     |
| 5    | **WebSearch** | LAST RESORT ONLY   | Only after steps 1-4 fail                                      |

## Research Decision Flow

1. **Check available MCP tools first** - Don't forget you have plugins!
   - Context7 for library docs: `resolve-library-id` → `query-docs`
   - IDE tools: `getDiagnostics` for code errors
2. **Has GitHub repo?** → `gh` CLI
   - `gh search issues "topic" --repo org/repo`
   - `gh issue list --repo org/repo --search "topic"`
   - `gh search code "pattern" --language yaml` - find real implementations
   - For raw files: WebFetch `raw.githubusercontent.com/...`
3. **Official docs URL known?** → WebFetch (allowed domains only)
4. **All above failed?** → WebSearch (state why others failed first)

## When Context7 Doesn't Have the Library

1. Check GitHub → `gh issue list --repo org/repo --search "topic"`
2. Fetch README → WebFetch `raw.githubusercontent.com/.../README.md`
3. Only then → WebSearch, explaining: "Context7 and GitHub don't have X, using web search"

## When Struggling or Unsure

If something isn't working or you're unsure about syntax/patterns:

1. **Don't trust training data blindly** - APIs and libraries change
2. **Search for real implementations** → `gh search code "the pattern" --language <lang>`
3. **Check recent issues** → `gh search issues "error message" --repo org/repo`
4. **Fetch actual source** → WebFetch `raw.githubusercontent.com/.../src/file.ts`

Your training data may be outdated. Verify with real code.
