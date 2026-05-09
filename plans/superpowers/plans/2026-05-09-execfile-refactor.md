# Replace Shell Command Strings with Argument Arrays

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `ICommandExecutor` from shell command strings to executable + argument arrays, eliminating shell interpretation and the CodeQL `js/indirect-command-line-injection` alert.

**Architecture:** Change the interface from `exec(command: string, cwd, opts)` to `exec(executable: string, args: string[], cwd, opts)`. The implementation switches from `execFileSync("sh", ["-c", command])` to `execFileSync(executable, args)`. Add `input?: string` to `ExecOptions` for stdin passthrough (replaces `echo X | cmd --input -` pipe patterns). Remove `escapeShellArg` entirely — no longer
needed without shell interpretation.

**Tech Stack:** TypeScript, Node.js `child_process.execFileSync`, node:test

**Issue:** [#719](https://github.com/anthony-spruyt/xfg/issues/719)

______________________________________________________________________

## File Map

### Core (change first — everything depends on these)

| File                             | Action | Responsibility                                                                                                                   |
| -------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/command-executor.ts` | Modify | Interface + implementation: new signature, `input` on ExecOptions                                                                |
| `src/shared/shell-utils.ts`      | Modify | Remove `escapeShellArg` (keep `escapeRegExp`)                                                                                    |
| `src/shared/gh-api-utils.ts`     | Modify | `buildHostnameFlag` to `buildHostnameArgs` returning `string[]`; `ghApiCall` uses args array + `input` for POST payloads         |
| `test/mocks/executor.mock.ts`    | Modify | New mock signature: track `{ executable, args, cwd, options }` instead of `{ command, cwd, options }`; response matching on args |

### VCS layer (change after core)

| File                                 | Action | Responsibility                                                                                              |
| ------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------- |
| `src/vcs/git-ops.ts`                 | Modify | 13 calls: private wrapper + all git commands to args arrays                                                 |
| `src/vcs/authenticated-git-ops.ts`   | Modify | `execWithRetry` wrapper + 8 network git commands to args arrays                                             |
| `src/vcs/github-pr-strategy.ts`      | Modify | 6 calls: `gh pr list/close/create/merge`, `gh api` to args arrays                                           |
| `src/vcs/ado-pr-strategy.ts`         | Modify | 6 calls: `az repos pr list/create/update`, `az repos ref` to args arrays                                    |
| `src/vcs/gitlab-pr-strategy.ts`      | Modify | 6 calls: `glab mr list/close/create/merge`, `git push` to args arrays; remove `$(cat file)` shell expansion |
| `src/vcs/graphql-commit-strategy.ts` | Modify | 5 calls: pipe pattern replaced with `input` option; `git fetch/rev-parse` to args                           |
| `src/vcs/git-commit-strategy.ts`     | Modify | 3 calls: `git commit/push/rev-parse` to args arrays                                                         |

### Lifecycle layer (change after core)

| File                                         | Action | Responsibility                                                                                                                                    |
| -------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lifecycle/github-lifecycle-provider.ts` | Modify | 14 calls: `gh repo create/fork/edit`, `gh api`, `git -C` to args arrays; `buildGhApiPrefix` returns arrays; `buildRepoCreateFlags` drops escaping |
| `src/lifecycle/ado-migration-source.ts`      | Modify | 1 call: `git clone --mirror` to args array                                                                                                        |

### Test files (change after source)

| File                                                    | Lines | Responsibility                                             |
| ------------------------------------------------------- | ----- | ---------------------------------------------------------- |
| `test/mocks/executor.mock.ts`                           | 110   | Mock infrastructure — change first                         |
| `test/unit/shared/command-executor.test.ts`             | 196   | ShellCommandExecutor integration tests — update signatures |
| `test/unit/shared/gh-api-utils.test.ts`                 | 484   | `buildHostnameFlag` to `buildHostnameArgs`                 |
| `test/unit/vcs/git-ops.test.ts`                         | 1214  | Git command assertions                                     |
| `test/unit/vcs/authenticated-git-ops.test.ts`           | 1053  | Network git command assertions                             |
| `test/unit/vcs/github-pr-strategy.test.ts`              | 1549  | gh CLI command assertions                                  |
| `test/unit/vcs/ado-pr-strategy.test.ts`                 | 1149  | az CLI command assertions                                  |
| `test/unit/vcs/gitlab-pr-strategy.test.ts`              | 1283  | glab CLI command assertions                                |
| `test/unit/vcs/graphql-commit-strategy.test.ts`         | 1743  | GraphQL mutation assertions                                |
| `test/unit/vcs/git-commit-strategy.test.ts`             | 307   | Git commit/push assertions                                 |
| `test/unit/lifecycle/github-lifecycle-provider.test.ts` | 1469  | Lifecycle gh CLI assertions                                |
| `test/unit/lifecycle/ado-migration-source.test.ts`      | 97    | ADO migration assertions                                   |

______________________________________________________________________

## Transformation Patterns

Reference these patterns when converting call sites. Every call site follows one of these shapes.

### Pattern A: Simple git command (no dynamic args)

```typescript
// BEFORE
await this.exec("git status --porcelain", this.workDir);

// AFTER
await this.exec("git", ["status", "--porcelain"], this.workDir);
```

### Pattern B: Git command with dynamic args (escapeShellArg removed)

```typescript
// BEFORE
await this.exec(`git checkout -b ${escapeShellArg(branchName)}`, this.workDir);

// AFTER
await this.exec("git", ["checkout", "-b", branchName], this.workDir);
```

### Pattern C: CLI command with flags and options

```typescript
// BEFORE
const command = `gh pr list --repo ${escapeShellArg(repoFlag)} --head ${escapeShellArg(branchName)} --json url --jq '.[0].url'`;
await this.executor.exec(command, workDir, { env: tokenEnv });

// AFTER
await this.executor.exec("gh", [
  "pr", "list",
  "--repo", repoFlag,
  "--head", branchName,
  "--json", "url",
  "--jq", ".[0].url",
], workDir, { env: tokenEnv });
```

### Pattern D: Piped command becomes stdin `input` option

```typescript
// BEFORE
const command = `echo ${escapeShellArg(requestBody)} | gh api graphql ${hostnameArg} --input -`;
await this.executor.exec(command, workDir, { env: tokenEnv });

// AFTER
const hostnameArgs = repoInfo.host !== "github.com"
  ? ["--hostname", repoInfo.host] : [];
await this.executor.exec("gh", [
  "api", "graphql", ...hostnameArgs, "--input", "-",
], workDir, { env: tokenEnv, input: requestBody });
```

### Pattern E: Shell expansion `$(cat file)` becomes direct arg

```typescript
// BEFORE
const command = `glab mr create --description "$(cat ${escapeShellArg(descFile)})" ...`;

// AFTER — pass body directly as arg (no shell needed)
await this.executor.exec("glab", [
  "mr", "create", "--description", body, ...
], workDir);
```

### Pattern F: `git -C <dir>` commands

```typescript
// BEFORE
await this.executor.exec(
  `git -C ${escapeShellArg(sourceDir)} remote remove origin`, this.cwd);

// AFTER
await this.executor.exec("git", [
  "-C", sourceDir, "remote", "remove", "origin",
], this.cwd);
```

### Pattern G: Command built from parts array

```typescript
// BEFORE
const parts: string[] = ["gh repo create", escapeShellArg(slug)];
buildRepoCreateFlags(parts, settings);
await this.executor.exec(parts.join(" "), this.cwd, { env });

// AFTER
const args: string[] = ["repo", "create", slug];
buildRepoCreateArgs(args, settings);
await this.executor.exec("gh", args, this.cwd, { env });
```

### Pattern H: `buildHostnameFlag` becomes `buildHostnameArgs`

```typescript
// BEFORE
const hostnameFlag = buildHostnameFlag(repoInfo);
const hostnamePart = hostnameFlag ? `${hostnameFlag} ` : "";
const command = `gh api ${hostnamePart}repos/${escapeShellArg(owner)}/${escapeShellArg(repo)}`;

// AFTER
const hostnameArgs = buildHostnameArgs(repoInfo);
await this.executor.exec("gh", [
  "api", ...hostnameArgs, `repos/${owner}/${repo}`,
], this.cwd, { env });
```

### Pattern I: Mock executor (tests)

```typescript
// BEFORE — track command strings
const mockExecutor = {
  exec: async (cmd: string) => { commands.push(cmd); return ""; },
};
// Assert: commands[0].includes("clone")

// AFTER — track executable + args
const mockExecutor = {
  exec: async (exe: string, args: string[]) => {
    calls.push({ executable: exe, args });
    return "";
  },
};
// Assert: calls[0].executable === "git" && calls[0].args.includes("clone")
```

### Pattern J: createMockExecutor response matching

```typescript
// BEFORE — responses matched by command.includes(pattern)
const { mock } = createMockExecutor({
  responses: new Map([["gh pr list", '{"url": "..."}']]),
});

// AFTER — responses matched by args containing pattern tokens
// The mock checks if ALL tokens in the pattern appear somewhere in
// [executable, ...args]. E.g., pattern "gh pr list" splits to
// ["gh", "pr", "list"] and matches if executable === "gh" and
// args includes "pr" and "list".
const { mock } = createMockExecutor({
  responses: new Map([["gh pr list", '{"url": "..."}']]),
});
```

______________________________________________________________________

## Tasks

### Task 1: Core Interface + Implementation

**Files:**

- Modify: `src/shared/command-executor.ts`

- [ ] **Step 1: Update `ExecOptions` interface**

Add `input` field for stdin passthrough:

```typescript
export interface ExecOptions {
  env?: Record<string, string>;
  input?: string;
}
```

- [ ] **Step 2: Update `ICommandExecutor` interface**

```typescript
export interface ICommandExecutor {
  exec(
    executable: string,
    args: string[],
    cwd: string,
    options?: ExecOptions
  ): Promise<string>;
}
```

- [ ] **Step 3: Update `ShellCommandExecutor` implementation**

```typescript
export class ShellCommandExecutor implements ICommandExecutor {
  private readonly baseEnv: Record<string, string | undefined>;

  constructor(baseEnv: Record<string, string | undefined>) {
    this.baseEnv = baseEnv;
  }

  async exec(
    executable: string,
    args: string[],
    cwd: string,
    options?: ExecOptions
  ): Promise<string> {
    try {
      return execFileSync(executable, args, {
        cwd,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        input: options?.input,
        env: options?.env
          ? { ...this.baseEnv, ...options.env }
          : (this.baseEnv as NodeJS.ProcessEnv),
      }).trim();
    } catch (error) {
      const execError = error as {
        stderr?: Buffer | string;
        message?: string;
      };
      if (execError.stderr && typeof execError.stderr !== "string") {
        execError.stderr = execError.stderr.toString();
      }
      if (execError.stderr) {
        execError.stderr = sanitizeCredentials(execError.stderr);
      }
      if (execError.stderr && execError.message) {
        execError.message =
          sanitizeCredentials(execError.message) + "\n" + execError.stderr;
      } else if (execError.message) {
        execError.message = sanitizeCredentials(execError.message);
      }
      throw error;
    }
  }
}
```

- [ ] **Step 4: Verify the file compiles**

Run: `npx tsc --noEmit src/shared/command-executor.ts 2>&1 | head -20`

This will produce many errors from downstream callers — that's expected. Only verify that `command-executor.ts` itself has no syntax errors.

- [ ] **Step 5: Commit**

```bash
git add src/shared/command-executor.ts
git commit -m "refactor: change ICommandExecutor to executable + args array

Replaces exec(command, ...) with exec(executable, args[], ...)
and adds input option to ExecOptions for stdin passthrough.
Implementation uses execFileSync(executable, args) directly,
eliminating shell interpretation entirely.

Ref #719"
```

______________________________________________________________________

### Task 2: Mock Executor Infrastructure

**Files:**

- Modify: `test/mocks/executor.mock.ts`

- [ ] **Step 1: Update mock implementation**

Response matching strategy: split pattern on spaces into tokens, then check if all tokens appear in `[executable, ...args]`.

```typescript
import type {
  ICommandExecutor,
  ExecOptions,
} from "../../src/shared/command-executor.js";

export type MockResponse = string | Error | (() => string | Error);

export interface ExecutorMockConfig {
  defaultResponse?: string;
  responses?: Map<string, MockResponse>;
  trackCalls?: boolean;
  trackGitCommands?: boolean;
}

export interface GitCommandTracking {
  lastCommitMessage: string | null;
  pushBranch: string | null;
  pushForce: boolean | undefined;
}

export interface ExecutorMockCall {
  executable: string;
  args: string[];
  cwd: string;
  options?: ExecOptions;
}

export interface ExecutorMockResult {
  mock: ICommandExecutor;
  calls: ExecutorMockCall[];
  responses: Map<string, MockResponse>;
  git: GitCommandTracking;
  reset: () => void;
}

function matchesPattern(
  executable: string,
  args: string[],
  pattern: string
): boolean {
  const allParts = [executable, ...args];
  const tokens = pattern.split(/\s+/);
  return tokens.every((token) => allParts.includes(token));
}

export function createMockExecutor(
  config: ExecutorMockConfig = {}
): ExecutorMockResult {
  const calls: ExecutorMockCall[] = [];
  const responses = config.responses ?? new Map();
  const defaultResponse = config.defaultResponse ?? "";

  const git: GitCommandTracking = {
    lastCommitMessage: null,
    pushBranch: null,
    pushForce: undefined,
  };

  const mock: ICommandExecutor = {
    async exec(
      executable: string,
      args: string[],
      cwd: string,
      opts?: ExecOptions
    ): Promise<string> {
      calls.push({ executable, args, cwd, options: opts });

      if (config.trackGitCommands && executable === "git") {
        if (args.includes("commit")) {
          const mIdx = args.indexOf("-m");
          if (mIdx !== -1 && mIdx + 1 < args.length) {
            git.lastCommitMessage = args[mIdx + 1];
          }
        }
        if (args.includes("push")) {
          git.pushForce = args.includes("--force-with-lease");
          const originIdx = args.indexOf("origin");
          if (originIdx !== -1 && originIdx + 1 < args.length) {
            git.pushBranch = args[originIdx + 1];
          }
        }
      }

      for (const [pattern, response] of responses) {
        if (matchesPattern(executable, args, pattern)) {
          const result =
            typeof response === "function" ? response() : response;
          if (result instanceof Error) {
            throw result;
          }
          return result;
        }
      }

      return defaultResponse;
    },
  };

  return {
    mock,
    calls,
    responses,
    git,
    reset: () => {
      calls.length = 0;
      git.lastCommitMessage = null;
      git.pushBranch = null;
      git.pushForce = undefined;
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add test/mocks/executor.mock.ts
git commit -m "refactor: update mock executor for executable + args signature

Response matching checks if pattern tokens appear in [executable, ...args]
instead of command.includes(pattern)."
```

______________________________________________________________________

### Task 3: Helper Functions (`gh-api-utils.ts`)

**Files:**

- Modify: `src/shared/gh-api-utils.ts`

- [ ] **Step 1: Rename `buildHostnameFlag` to `buildHostnameArgs`**

```typescript
export function buildHostnameArgs(
  repoInfo: Pick<GitHubApiTarget, "host">
): string[] {
  if (repoInfo.host !== "github.com") {
    return ["--hostname", repoInfo.host];
  }
  return [];
}
```

- [ ] **Step 2: Update `ghApiCall` to use args array + `input` option**

```typescript
async function ghApiCall(
  method: HttpMethod,
  endpoint: string,
  opts: GhApiCallOptions
): Promise<string> {
  const { executor, retries, cwd, apiOpts, payload, paginate } = opts;
  const args: string[] = ["api"];

  if (method !== "GET") {
    args.push("-X", method);
  }

  if (paginate) {
    args.push("--paginate");
  } else {
    args.push("--include");
  }

  if (apiOpts?.host && apiOpts.host !== "github.com") {
    args.push("--hostname", apiOpts.host);
  }

  args.push(endpoint);

  const env = buildTokenEnv(apiOpts?.token);

  const execAndParse = async (
    execArgs: string[],
    execOptions?: ExecOptions
  ): Promise<string> => {
    try {
      const raw = await executor.exec("gh", execArgs, cwd, execOptions);
      return paginate ? raw : parseResponseBody(raw);
    } catch (error) {
      if (!paginate) {
        attachRetryAfter(error);
        attachValidationDetails(error);
      }
      throw error;
    }
  };

  const retryOpts = {
    retries,
    ...(opts._retryDelay ? { _delay: opts._retryDelay } : {}),
  };

  if (
    payload &&
    (method === "POST" || method === "PUT" || method === "PATCH")
  ) {
    const payloadJson = JSON.stringify(payload);
    const payloadArgs = [...args, "--input", "-"];
    return withRetry(
      () => execAndParse(payloadArgs, { env, input: payloadJson }),
      retryOpts
    );
  }

  return withRetry(() => execAndParse(args, { env }), retryOpts);
}
```

- [ ] **Step 3: Remove `escapeShellArg` import**

Remove `import { escapeShellArg } from "./shell-utils.js";`

- [ ] **Step 4: Commit**

```bash
git add src/shared/gh-api-utils.ts
git commit -m "refactor: update gh-api-utils for args pattern

buildHostnameFlag becomes buildHostnameArgs (returns string[]).
ghApiCall builds args array and uses input option for POST payloads
instead of echo pipe pattern."
```

______________________________________________________________________

### Task 4: `git-ops.ts`

**Files:**

- Modify: `src/vcs/git-ops.ts`

This file has a private `exec(command, cwd?)` wrapper that delegates to `this.executor.exec(command, cwd ?? this.workDir)`. Update wrapper and all 13 call sites.

- [ ] **Step 1: Update private `exec` wrapper**

```typescript
private exec(
  executable: string,
  args: string[],
  cwd?: string
): Promise<string> {
  return this.executor.exec(executable, args, cwd ?? this.workDir);
}
```

- [ ] **Step 2: Update all methods**

Apply Pattern A/B to each method. Key conversions:

`createBranch`: `"git", ["checkout", "-b", branchName]` `setExecutable`: `"git", ["update-index", "--add", "--chmod=+x", relativePath]` `clearExecutable`: `"git", ["update-index", "--chmod=-x", "--", fileName]` `getFileMode`: `"git", ["ls-files", "-s", "--", fileName]` `hasChanges`: `"git", ["status", "--porcelain"]` `getChangedFiles`: `"git", ["status", "--porcelain"]` `stageAll`:
`"git", ["add", "-A"]` `hasStagedChanges`: `"git", ["diff", "--cached", "--name-only"]` `fileExistsOnBranch`: `"git", ["show", branch + ":" + fileName]` (note: `${branch}:${fileName}` is a single git argument) `commit`: `"git", ["add", "-A"]` + `"git", ["commit", "--no-verify", "-m", message]` `getDefaultBranchLocal`: `"git", ["rev-parse", "--verify", "origin/main"]` (and origin/master)

- [ ] **Step 3: Remove `escapeShellArg` import**

- [ ] **Step 4: Commit**

```bash
git add src/vcs/git-ops.ts
git commit -m "refactor: convert git-ops to args pattern

All 13 git commands use exec(executable, args[]) instead of
shell command strings. Removes escapeShellArg dependency."
```

______________________________________________________________________

### Task 5: `authenticated-git-ops.ts`

**Files:**

- Modify: `src/vcs/authenticated-git-ops.ts`

- [ ] **Step 1: Update `execWithRetry` wrapper**

```typescript
private execWithRetry(executable: string, args: string[]): Promise<string> {
  return withRetry(
    () => this.executor.exec(executable, args, this.workDir),
    { retries: this.retries }
  );
}
```

- [ ] **Step 2: Update all network methods**

`clone`: `"git", ["clone", gitUrl, "."]` or `"git", ["clone", authUrl, "."]` `fetch`: `"git", ["fetch", "origin"]` + optional `"--prune"` `push`: `"git", ["push", ...forceArgs, "-u", "origin", branchName]` `getDefaultBranch`: `"git", ["remote", "show", "origin"]` `lsRemote`: `"git", ["ls-remote", "--exit-code", "--heads", "origin", branchName]` `pushRefspec`:
`"git", ["push", ...deleteArgs, "-u", "origin", refspec]` `fetchBranch`: `"git", ["fetch", "origin", "+branchName:refs/remotes/origin/branchName"]`

- [ ] **Step 3: Remove `escapeShellArg` import and safety comment**

- [ ] **Step 4: Commit**

```bash
git add src/vcs/authenticated-git-ops.ts
git commit -m "refactor: convert authenticated-git-ops to args pattern

All network git commands use executable + args arrays."
```

______________________________________________________________________

### Task 6: `github-pr-strategy.ts`

**Files:**

- Modify: `src/vcs/github-pr-strategy.ts`

- [ ] **Step 1: Update all methods using Patterns C and H**

`findExistingPRUrl`: `"gh", ["pr", "list", "--repo", repoFlag, "--head", branchName, "--json", "url", "--jq", ".[0].url"]` `closeExistingPR`: `"gh", ["pr", "close", prNumber, "--repo", repoFlag, "--delete-branch"]` `create`: `"gh", ["pr", "create", "--title", title, "--body-file", bodyFile, "--base", baseBranch, "--head", branchName, ...labelArgs]` `checkAutoMergeEnabled`:
`"gh", ["api", ...hostnameArgs, "repos/owner/repo", "--jq", ".allow_auto_merge // false"]` `merge` (auto): `"gh", ["pr", "merge", prUrl, "--auto", strategyFlag, ...deleteBranchArgs]` `merge` (force): `"gh", ["pr", "merge", prUrl, "--admin", strategyFlag, ...deleteBranchArgs]`

- [ ] **Step 2: Update imports**

Replace `escapeShellArg, escapeRegExp` with just `escapeRegExp`. Replace `buildHostnameFlag` with `buildHostnameArgs`.

- [ ] **Step 3: Commit**

```bash
git add src/vcs/github-pr-strategy.ts
git commit -m "refactor: convert github-pr-strategy to args pattern"
```

______________________________________________________________________

### Task 7: `ado-pr-strategy.ts`

**Files:**

- Modify: `src/vcs/ado-pr-strategy.ts`

- [ ] **Step 1: Update all methods**

`findExistingPRId`: `"az", ["repos", "pr", "list", "--repository", repo, "--source-branch", branchName, "--target-branch", baseBranch, "--org", orgUrl, "--project", project, "--query", "[0].pullRequestId", "-o", "tsv"]` `closeExistingPR`:

- abandon: `"az", ["repos", "pr", "update", "--id", prId, "--status", "abandoned", "--org", orgUrl]`

- get ref: `"az", ["repos", "ref", "list", "--repository", repo, "--org", orgUrl, "--project", project, "--filter", "heads/branchName", "--query", "[0].objectId", "-o", "tsv"]`

- delete branch: `"az", ["repos", "ref", "delete", "--name", "refs/heads/branchName", "--repository", repo, "--org", orgUrl, "--project", project, "--object-id", objectId]` `create`:
  `"az", ["repos", "pr", "create", "--repository", repo, "--source-branch", branchName, "--target-branch", baseBranch, "--title", title, "--description", "@" + descFile, "--org", orgUrl, "--project", project, "--query", "pullRequestId", "-o", "tsv"]` `merge`:

- auto: `"az", ["repos", "pr", "update", "--id", prId, "--auto-complete", "true", ...squashArgs, ...deleteBranchArgs, "--org", orgUrl]`

- force: `"az", ["repos", "pr", "update", "--id", prId, "--bypass-policy", "true", "--bypass-policy-reason", reason, "--status", "completed", ...squashArgs, ...deleteBranchArgs, "--org", orgUrl]`

- [ ] **Step 2: Remove `escapeShellArg` import**

- [ ] **Step 3: Commit**

```bash
git add src/vcs/ado-pr-strategy.ts
git commit -m "refactor: convert ado-pr-strategy to args pattern"
```

______________________________________________________________________

### Task 8: `gitlab-pr-strategy.ts`

**Files:**

- Modify: `src/vcs/gitlab-pr-strategy.ts`

Special: `$(cat file)` shell expansion in `create` replaced by passing `body` directly as `--description` arg. File write/cleanup removed — only needed for shell escaping.

- [ ] **Step 1: Update all methods**

`findExistingPRUrl`: `"glab", ["mr", "list", "--source-branch", branchName, "-R", repoFlag, "-F", "json"]` `closeExistingPR`:

- close: `"glab", ["mr", "close", mrIid, "-R", repoFlag]`

- delete branch: `"git", ["push", "origin", "--delete", branchName]` `create`: Pass `body` directly as `--description` arg. Remove file write/cleanup/try-finally.

- `"glab", ["mr", "create", "--source-branch", branchName, "--target-branch", baseBranch, "--title", title, "--description", body, "--yes", "-R", repoFlag]` `merge` (auto): `"glab", ["mr", "merge", mrIid, "--when-pipeline-succeeds", ...strategyArgs, ...deleteBranchArgs, "-R", repoFlag, "-y"]` `merge` (force):
  `"glab", ["mr", "merge", mrIid, ...strategyArgs, ...deleteBranchArgs, "-R", repoFlag, "-y"]`

- [ ] **Step 2: Remove `escapeShellArg` import, clean up unused fs imports**

Remove `writeFileSync`, `unlinkSync`, `existsSync`, `join` if no longer used. Remove `safeCleanup`, `NO_OP_DEBUG_LOG` imports if no longer used.

- [ ] **Step 3: Commit**

```bash
git add src/vcs/gitlab-pr-strategy.ts
git commit -m "refactor: convert gitlab-pr-strategy to args pattern

Removes $(cat file) shell expansion — body passed directly as arg.
Simplifies create() by eliminating temp file write/cleanup."
```

______________________________________________________________________

### Task 9: `graphql-commit-strategy.ts`

**Files:**

- Modify: `src/vcs/graphql-commit-strategy.ts`

Key: `echo ... | gh api graphql --input -` becomes `exec("gh", ["api", "graphql", ...hostnameArgs, "--input", "-"], workDir, { input: requestBody })`.

- [ ] **Step 1: Update `executeGraphQLMutation`**

Replace pipe command with:

```typescript
const hostnameArgs =
  repoInfo.host !== "github.com" ? ["--hostname", repoInfo.host] : [];
const tokenEnv = buildTokenEnv(token);

response = await withRetry(
  () => this.executor.exec(
    "gh",
    ["api", "graphql", ...hostnameArgs, "--input", "-"],
    workDir,
    { env: tokenEnv, input: requestBody }
  ),
  { permanentErrorPatterns: [...] }
);
```

- [ ] **Step 2: Update `executeGraphQLRefOp`**

Same pattern as above for the ref operation helper.

- [ ] **Step 3: Update git commands**

`git fetch`: `"git", ["fetch", "origin", "+branchName:refs/remotes/origin/branchName"]` `git rev-parse`: `"git", ["rev-parse", "origin/branchName"]` and `"git", ["rev-parse", "HEAD"]`

- [ ] **Step 4: Remove `escapeShellArg` import**

- [ ] **Step 5: Commit**

```bash
git add src/vcs/graphql-commit-strategy.ts
git commit -m "refactor: convert graphql-commit-strategy to args pattern

Pipe pattern replaced with stdin input option.
Git commands use args arrays."
```

______________________________________________________________________

### Task 10: `git-commit-strategy.ts`

**Files:**

- Modify: `src/vcs/git-commit-strategy.ts`

- [ ] **Step 1: Update all three commands**

`git commit`: `"git", ["commit", "--no-verify", "-m", message]` `git push`: `"git", ["push", ...forceArgs, "-u", "origin", branchName]` `git rev-parse`: `"git", ["rev-parse", "HEAD"]`

- [ ] **Step 2: Remove `escapeShellArg` import**

- [ ] **Step 3: Commit**

```bash
git add src/vcs/git-commit-strategy.ts
git commit -m "refactor: convert git-commit-strategy to args pattern"
```

______________________________________________________________________

### Task 11: `github-lifecycle-provider.ts`

**Files:**

- Modify: `src/lifecycle/github-lifecycle-provider.ts`

Largest file with 14 call sites.

- [ ] **Step 1: Update `buildRepoCreateFlags` to `buildRepoCreateArgs`**

Remove `escapeShellArg` from description push:

```typescript
function buildRepoCreateArgs(
  args: string[],
  settings: CreateRepoSettings | undefined
): void {
  if (settings?.visibility === "public") {
    args.push("--public");
  } else if (settings?.visibility === "internal") {
    args.push("--internal");
  } else {
    args.push("--private");
  }
  if (settings?.description) {
    args.push("--description", settings.description);
  }
  if (settings?.hasIssues === false) {
    args.push("--disable-issues");
  }
  if (settings?.hasWiki === false) {
    args.push("--disable-wiki");
  }
}
```

- [ ] **Step 2: Update `buildGhApiPrefix` to return arrays**

```typescript
private buildGhApiPrefix(
  repoInfo: GitHubRepoInfo,
  token?: string
): {
  tokenEnv: Record<string, string> | undefined;
  baseArgs: string[];
  apiPath: string;
} {
  const tokenEnv = buildTokenEnv(token);
  const hostnameArgs = buildHostnameArgs(repoInfo);
  const apiPath = `repos/${repoInfo.owner}/${repoInfo.repo}`;
  return { tokenEnv, baseArgs: ["api", ...hostnameArgs], apiPath };
}
```

- [ ] **Step 3: Update all methods**

Apply Pattern F for `git -C` commands and Pattern H for gh api commands. All 14 call sites need conversion. Key methods:

`isOrganization`: `"gh", [...baseArgs, "users/" + owner]` `exists`: `"gh", [...baseArgs, apiPath]` `create`: `"gh", ["repo", "create", slug, ...createArgs, "--add-readme"]` + branch rename + readme delete `fork`: `"gh", ["repo", "fork", upstreamSlug, ...orgArgs, "--fork-name", repo, "--clone=false"]` `applyRepoSettings`: `"gh", ["repo", "edit", slug, ...settingsArgs]` `removeOriginRemote`:
`"git", ["-C", sourceDir, "remote", "remove", "origin"]` `cleanNonStandardRefs`: `"git", ["-C", sourceDir, "for-each-ref", "--format=%(refname)"]` + `"git", ["-C", sourceDir, "update-ref", "-d", ref]` `renameMirrorDefaultBranch`: `"git", ["-C", sourceDir, "symbolic-ref", "HEAD"]` + `"git", ["-C", sourceDir, "branch", "-m", source, target]` +
`"git", ["-C", sourceDir, "symbolic-ref", "HEAD", "refs/heads/" + target]` `createRepoAndPushMirror`: `"gh", ["repo", "create", slug, ...args]` + `"git", ["-C", sourceDir, "remote", "add", "origin", remoteUrl]` + `"git", ["-C", sourceDir, "push", "--mirror", "origin"]` `renameBranch`:
`"gh", [...baseArgs, apiPath + "/branches/" + current + "/rename", "--method", "POST", "-f", "new_name=" + desired]` `waitForDefaultBranch`: `"gh", [...baseArgs, apiPath, "--jq", ".default_branch"]` `deleteReadme`: `"gh", [...baseArgs, apiPath + "/contents/README.md", "--jq", ".sha"]` +
`"gh", [...baseArgs, apiPath + "/contents/README.md", "--method", "DELETE", "-f", "message=Remove initialization file", "-f", "sha=" + sha]`

Note for `--format=%(refname)`: the shell quotes around `'%(refname)'` were for shell protection. With execFileSync, pass it directly without quotes: `"--format=%(refname)"`.

- [ ] **Step 4: Update imports**

Remove `escapeShellArg` import. Replace `buildHostnameFlag` with `buildHostnameArgs`.

- [ ] **Step 5: Commit**

```bash
git add src/lifecycle/github-lifecycle-provider.ts
git commit -m "refactor: convert github-lifecycle-provider to args pattern

All 14 calls use executable + args arrays.
buildGhApiPrefix returns arrays. buildRepoCreateFlags renamed to
buildRepoCreateArgs and drops escaping."
```

______________________________________________________________________

### Task 12: `ado-migration-source.ts`

**Files:**

- Modify: `src/lifecycle/ado-migration-source.ts`

- [ ] **Step 1: Update `cloneForMigration`**

`"git", ["clone", "--mirror", repoInfo.gitUrl, workDir]`

- [ ] **Step 2: Remove `escapeShellArg` import**

- [ ] **Step 3: Commit**

```bash
git add src/lifecycle/ado-migration-source.ts
git commit -m "refactor: convert ado-migration-source to args pattern"
```

______________________________________________________________________

### Task 13: Remove `escapeShellArg` from `shell-utils.ts`

**Files:**

- Modify: `src/shared/shell-utils.ts`

Do this AFTER all callers are updated (Tasks 4-12).

- [ ] **Step 1: Remove `escapeShellArg` and its import**

File becomes:

```typescript
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

- [ ] **Step 2: Verify no remaining references**

Run: `grep -rn 'escapeShellArg' src/ --include='*.ts'` Expected: no results.

- [ ] **Step 3: Commit**

```bash
git add src/shared/shell-utils.ts
git commit -m "refactor: remove escapeShellArg from shell-utils

No longer needed — arguments passed directly without shell
interpretation. escapeRegExp retained (used by PR URL builders)."
```

______________________________________________________________________

### Task 14: Update Tests — `command-executor.test.ts`

**Files:**

- Modify: `test/unit/shared/command-executor.test.ts`

Since implementation now uses `execFileSync(executable, args)`, tests must pass executable + args. The pipe test is removed (pipes require a shell). A stdin `input` test is added.

- [ ] **Step 1: Update all tests**

Key conversions:

- `exec("echo hello", dir)` becomes `exec("echo", ["hello"], dir)`

- `exec("ls test.txt", dir)` becomes `exec("ls", ["test.txt"], dir)`

- `exec("echo one two three", dir)` becomes `exec("echo", ["one", "two", "three"], dir)`

- Remove pipe test, add `input` test: `exec("cat", [], dir, { input: "hello" })`

- Error tests: `exec("nonexistent_command_xyz", [], dir)` and `exec("false", [], dir)`

- Credential tests: `exec("node", ["-e", "console.error(...)..."], ".")`

- Mock interface tests: update signature to match `(executable, args, cwd)`

- [ ] **Step 2: Commit**

```bash
git add test/unit/shared/command-executor.test.ts
git commit -m "test: update command-executor tests for args signature

Removes pipe test (requires shell), adds stdin input test."
```

______________________________________________________________________

### Task 15: Update Tests — All VCS + Lifecycle Tests

**Files:**

- Modify: All test files listed in File Map (test section)

This is the largest task. Every test that creates inline mock executors or asserts on `calls[n].command` needs updating.

**Inline mock pattern** (authenticated-git-ops.test.ts):

```typescript
// BEFORE
const commands: string[] = [];
const mockExecutor = {
  exec: async (cmd: string) => { commands.push(cmd); return ""; },
};
assert.ok(commands[0].includes("clone"));

// AFTER
const calls: Array<{ executable: string; args: string[] }> = [];
const mockExecutor: ICommandExecutor = {
  async exec(exe: string, args: string[]) {
    calls.push({ executable: exe, args });
    return "";
  },
};
assert.strictEqual(calls[0].executable, "git");
assert.ok(calls[0].args.includes("clone"));
```

**createMockExecutor assertion pattern** (PR strategy tests):

```typescript
// BEFORE
const listCmd = mockExecutor.calls[0].command;
assert.ok(listCmd.includes("--repo"));

// AFTER
const call = mockExecutor.calls[0];
assert.strictEqual(call.executable, "gh");
assert.ok(call.args.includes("--repo"));
```

Process each file in order:

1. `test/unit/vcs/git-ops.test.ts` — `stubExecutor` signature update
1. `test/unit/vcs/authenticated-git-ops.test.ts` — inline mock executors
1. `test/unit/vcs/github-pr-strategy.test.ts` — createMockExecutor assertions
1. `test/unit/vcs/ado-pr-strategy.test.ts` — createMockExecutor assertions
1. `test/unit/vcs/gitlab-pr-strategy.test.ts` — createMockExecutor assertions
1. `test/unit/vcs/graphql-commit-strategy.test.ts` — createMockExecutor assertions
1. `test/unit/vcs/git-commit-strategy.test.ts` — createMockExecutor assertions
1. `test/unit/shared/gh-api-utils.test.ts` — `buildHostnameFlag` to `buildHostnameArgs`
1. `test/unit/lifecycle/github-lifecycle-provider.test.ts` — createMockExecutor assertions
1. `test/unit/lifecycle/ado-migration-source.test.ts` — createMockExecutor assertions

- [ ] **Step 1-10: Update each test file**

For each file:

1. Update mock executor creation (inline or createMockExecutor — both work since mock updated in Task 2)
1. Update all `calls[n].command` to `calls[n].executable` + `calls[n].args` assertions
1. Update `command.includes()` assertions to `args.includes()` or `executable ===`
1. Update `stubExecutor` if present

- [ ] **Step 11: Run full test suite**

Run: `npm test 2>&1 | tail -40`

All tests should pass.

- [ ] **Step 12: Commit**

```bash
git add test/
git commit -m "test: update all tests for args signature

Updates mock executors, assertion patterns, and response matching
across all VCS and lifecycle test files."
```

______________________________________________________________________

### Task 16: Final Verification

- [ ] **Step 1: Verify no escapeShellArg references remain**

```bash
grep -rn 'escapeShellArg' src/ test/ --include='*.ts'
```

Expected: no results.

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

- [ ] **Step 3: Run type check**

```bash
npm run test:typecheck
```

- [ ] **Step 4: Run linting**

```bash
./lint.sh
```

- [ ] **Step 5: Run integration tests**

```bash
npm run test:integration:github
npm run test:integration:ado
npm run test:integration:gitlab
```

- [ ] **Step 6: Final commit if cleanup needed**

```bash
git add -A
git commit -m "refactor: complete migration to argument arrays

Closes #719"
```
