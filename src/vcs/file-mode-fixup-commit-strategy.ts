import type {
  ICommitStrategy,
  CommitOptions,
  CommitResult,
  FileChange,
} from "./types.js";
import type { ICommandExecutor } from "../shared/command-executor.js";
import { isGitHubRepo, type GitHubRepoInfo } from "../repo/index.js";
import { GhApiClient, type GhApiOptions } from "../shared/gh-api-utils.js";
import { parseApiJson } from "../shared/json-utils.js";
import { SyncError } from "../shared/errors.js";
import { validateSafeBranchName } from "./graphql-commit-strategy.js";

interface GitCommitResponse {
  sha: string;
  tree: { sha: string };
}

interface GitTreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
}

interface GitTreeResponse {
  sha: string;
  tree: GitTreeEntry[];
  truncated?: boolean;
}

interface GitCreateTreeResponse {
  sha: string;
}

interface GitCreateCommitResponse {
  sha: string;
}

/** Factory type for GhApiClient — enables test injection. */
export type GhApiClientFactory = (
  executor: ICommandExecutor,
  retries: number,
  cwd: string
) => GhApiClient;

const defaultClientFactory: GhApiClientFactory = (executor, retries, cwd) =>
  new GhApiClient(executor, retries, cwd);

/**
 * Decorator that adds a follow-up commit to fix executable file modes.
 *
 * The GitHub GraphQL createCommitOnBranch mutation cannot set file modes.
 * After the inner strategy (GraphQLCommitStrategy) creates the content commit,
 * this decorator creates a second commit via the REST Git Data API that
 * patches tree modes from 100644 to 100755 for executable files.
 *
 * Only activates when fileChanges contain entries with mode "100755".
 * When no executable files are present, delegates directly to the inner strategy.
 */
export class FileModeFixupCommitStrategy implements ICommitStrategy {
  constructor(
    private readonly inner: ICommitStrategy,
    private readonly executor: ICommandExecutor,
    private readonly clientFactory: GhApiClientFactory = defaultClientFactory
  ) {}

  async commit(options: CommitOptions): Promise<CommitResult> {
    validateSafeBranchName(options.branchName);

    const executableFiles = options.fileChanges.filter(
      (fc) => fc.modeOnly === true || fc.mode !== undefined
    );
    const hasContentChanges = options.fileChanges.some((fc) => !fc.modeOnly);

    if (executableFiles.length === 0) {
      return this.inner.commit(options);
    }

    if (!isGitHubRepo(options.repoInfo)) {
      return this.inner.commit(options);
    }

    let parentSha: string;
    let baseResult: CommitResult;

    if (hasContentChanges) {
      baseResult = await this.inner.commit(options);
      parentSha = baseResult.sha;
    } else {
      parentSha = await this.resolveBranchHeadSha(
        options.repoInfo,
        options.branchName,
        options.baseBranch,
        options.workDir,
        options.retries ?? 3,
        options.token
      );
      baseResult = { sha: parentSha, verified: true, pushed: true };
    }

    return await this.createFixupCommit(
      options.repoInfo,
      options.branchName,
      baseResult,
      executableFiles,
      options.workDir,
      options.retries ?? 3,
      options.token
    );
  }

  private async resolveBranchHeadSha(
    repoInfo: GitHubRepoInfo,
    branchName: string,
    baseBranch: string | undefined,
    workDir: string,
    retries: number,
    token?: string
  ): Promise<string> {
    validateSafeBranchName(branchName);
    if (baseBranch !== undefined) {
      validateSafeBranchName(baseBranch);
    }

    const client = this.clientFactory(this.executor, retries, workDir);
    const apiOpts: GhApiOptions = { token, host: repoInfo.host };
    const repoPath = `repos/${repoInfo.owner}/${repoInfo.repo}`;
    const getBranchRef = async (ref: string): Promise<string> => {
      const raw = await client.call("GET", `${repoPath}/git/ref/heads/${ref}`, {
        options: apiOpts,
      });
      const parsed = parseApiJson<{ object: { sha: string } }>(
        raw,
        "GET git ref"
      );
      return parsed.object.sha;
    };

    try {
      return await getBranchRef(branchName);
    } catch (err) {
      const is404 = err instanceof Error && /404|Not Found/i.test(err.message);
      if (!is404 || !baseBranch) throw err;

      const baseSha = await getBranchRef(baseBranch);

      try {
        await client.call("POST", `${repoPath}/git/refs`, {
          payload: { ref: `refs/heads/${branchName}`, sha: baseSha },
          options: apiOpts,
        });
        return baseSha;
      } catch (createErr) {
        const alreadyExists =
          createErr instanceof Error &&
          /Reference already exists/i.test(createErr.message);
        if (!alreadyExists) throw createErr;
        return await getBranchRef(branchName);
      }
    }
  }

  /**
   * Create a fixup commit that patches file modes (100644 ↔ 100755).
   *
   * Flow:
   * 1. GET the parent commit to find its tree SHA
   * 2. GET the tree (recursive) to find blob SHAs for target files
   * 3. POST a new tree with updated modes (base_tree carries forward unchanged)
   * 4. POST a new commit with the new tree
   * 5. PATCH the branch ref to point to the new commit
   */
  private async createFixupCommit(
    repoInfo: GitHubRepoInfo,
    branchName: string,
    innerResult: CommitResult,
    executableFiles: FileChange[],
    workDir: string,
    retries: number,
    token?: string
  ): Promise<CommitResult> {
    const parentSha = innerResult.sha;
    const client = this.clientFactory(this.executor, retries, workDir);
    const apiOpts: GhApiOptions = {
      token,
      host: repoInfo.host,
    };
    const repoPath = `repos/${repoInfo.owner}/${repoInfo.repo}`;

    // 1. Get the commit to find tree SHA
    const commitRaw = await client.call(
      "GET",
      `${repoPath}/git/commits/${parentSha}`,
      { options: apiOpts }
    );
    const commitData = parseApiJson<GitCommitResponse>(
      commitRaw,
      "GET git commit"
    );
    const treeSha = commitData.tree.sha;

    // 2. Get tree entries to find blob SHAs
    const treeRaw = await client.call(
      "GET",
      `${repoPath}/git/trees/${treeSha}?recursive=1`,
      { options: apiOpts }
    );
    const treeData = parseApiJson<GitTreeResponse>(treeRaw, "GET git tree");

    const treeEntries: Array<{
      path: string;
      mode: string;
      type: string;
      sha: string;
    }> = [];
    const requestedPaths = new Set(executableFiles.map((f) => f.path));

    for (const entry of treeData.tree) {
      const requested = executableFiles.find((f) => f.path === entry.path);
      if (!requested || entry.type !== "blob") continue;
      const desiredMode = requested.mode ?? "100755";
      if (entry.mode === desiredMode) continue;
      treeEntries.push({
        path: entry.path,
        mode: desiredMode,
        type: "blob",
        sha: entry.sha,
      });
    }

    if (treeData.truncated) {
      const foundPaths = new Set(
        treeData.tree.filter((e) => e.type === "blob").map((e) => e.path)
      );
      const missing = [...requestedPaths].filter((p) => !foundPaths.has(p));
      if (missing.length > 0) {
        throw new SyncError(
          `File mode fixup incomplete: tree response was truncated (>100k entries) ` +
            `and ${missing.length} executable file(s) were not found: ${missing.join(", ")}`
        );
      }
    }

    if (treeEntries.length === 0) {
      // All requested files are either already 100755 or absent from the tree.
      // Absent files in a non-truncated tree means createCommitOnBranch did not
      // include them (e.g., concurrent deletion) — safe to skip since there is
      // no blob to patch.
      return innerResult;
    }

    // 3. Create new tree with updated modes
    const newTreeRaw = await client.call("POST", `${repoPath}/git/trees`, {
      payload: { base_tree: treeSha, tree: treeEntries },
      options: apiOpts,
    });
    const newTree = parseApiJson<GitCreateTreeResponse>(
      newTreeRaw,
      "POST git tree"
    );

    // 4. Create fixup commit (message is not user-customizable; this is an
    // internal implementation detail of the mode-patching decorator)
    const newCommitRaw = await client.call("POST", `${repoPath}/git/commits`, {
      payload: {
        message: "chore: set executable file modes",
        tree: newTree.sha,
        parents: [parentSha],
      },
      options: apiOpts,
    });
    const newCommit = parseApiJson<GitCreateCommitResponse>(
      newCommitRaw,
      "POST git commit"
    );

    // 5. Update branch ref (fast-forward only; force is not needed since the
    // fixup commit's parent is always the content commit we just created).
    // Branch names with slashes (e.g. "chore/sync-config") are passed verbatim —
    // the GitHub REST API accepts literal slashes in ref paths.
    await client.call("PATCH", `${repoPath}/git/refs/heads/${branchName}`, {
      payload: { sha: newCommit.sha },
      options: apiOpts,
    });

    return {
      sha: newCommit.sha,
      verified: true,
      pushed: true,
    };
  }
}
