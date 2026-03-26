import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import Bottleneck from "bottleneck";

const execFileAsync = promisify(execFile);

const limiter = new Bottleneck({
  maxConcurrent: 2,
  minTime: 2000,
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const projectRoot = join(__dirname, "../..");

/**
 * Execute a shell command and return output.
 * This helper is only used in integration tests with hardcoded commands.
 * The commands are controlled and not derived from external/user input.
 * All outbound commands are paced through a shared bottleneck limiter.
 *
 * Note: Uses execFile("sh", ["-c", command]) which requires shell features
 * (pipes, env expansion). All command arguments are controlled test constants
 * (repo names from generateRepoName, hardcoded field names), never external input.
 */
export async function exec(
  command: string,
  options?: { cwd?: string; env?: Record<string, string | undefined> }
): Promise<string> {
  return limiter.schedule(async () => {
    try {
      const { stdout } = await execFileAsync("sh", ["-c", command], {
        cwd: options?.cwd ?? projectRoot,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
        ...(options?.env && { env: { ...process.env, ...options.env } }),
      });
      return stdout.trim();
    } catch (error) {
      const err = error as { stderr?: string; stdout?: string };
      console.error("Command failed:", command);
      console.error("stderr:", err.stderr);
      console.error("stdout:", err.stdout);
      throw error;
    }
  });
}

/**
 * Transient HTTP error patterns from the GitHub API that warrant a retry.
 */
const TRANSIENT_ERROR_PATTERNS = [
  // Existing GitHub-specific patterns
  /502/i,
  /503/i,
  /504/i,
  /500/i,
  /Server Error/i,
  /Service Unavailable/i,
  /rate limit/i,
  /secondary rate/i,
  /abuse detection/i,
  /too many requests/i,
  /retry-after/i,
  /429/,
  /403.*rate/i,
  // Network / timeout errors (covers az, glab, curl)
  /timed?\s*out/i,
  /ETIMEDOUT/,
  /ECONNRESET/,
  /ECONNREFUSED/,
  /ENOTFOUND/,
  /connection\s*(reset|refused|closed)/i,
  /network\s*(error|unreachable)/i,
  // Platform-agnostic server errors
  /temporarily\s*unavailable/i,
  /internal\s*server\s*error/i,
  /temporary\s*(failure|error)/i,
  /please try again later/i,
  // DNS
  /could\s*not\s*resolve\s*host/i,
  /unable\s*to\s*access/i,
];

/**
 * Rate-limit-specific detection patterns.
 * Used to distinguish rate limit errors from other transient errors
 * for Retry-After handling.
 */
const RATE_LIMIT_PATTERNS = [
  /rate limit/i,
  /secondary rate/i,
  /abuse detection/i,
  /too many requests/i,
  /429/,
  /403.*rate/i,
];

/**
 * Parse a Retry-After value from error text (seconds → ms).
 */
function parseRetryAfter(errorText: string): number | null {
  const match = /retry-after:\s*(\d+)/i.exec(errorText);
  if (match) {
    return parseInt(match[1], 10) * 1000;
  }
  return null;
}

/**
 * Async delay helper.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Unified retry primitive for integration tests.
 * Uses async exponential backoff with rate limit detection.
 *
 * @param fn - Function to retry. Returns a value on success, throws on failure.
 * @param options.retries - Number of retries (default: 6)
 * @param options.baseDelayMs - Base delay in ms, doubles each retry (default: 2000)
 * @param options.description - Human-readable description for log messages
 */
export async function withTestRetry<T>(
  fn: () => T | Promise<T>,
  options?: {
    retries?: number;
    baseDelayMs?: number;
    description?: string;
  }
): Promise<T> {
  const retries = options?.retries ?? 6;
  const baseDelayMs = options?.baseDelayMs ?? 2000;
  const description = options?.description ?? "operation";

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isPermanent =
        error instanceof Error &&
        "permanent" in error &&
        (error as { permanent: boolean }).permanent;
      if (attempt > retries || isPermanent) {
        throw error instanceof Error
          ? error
          : new Error(
              `${description}: failed after ${retries} retries: ${String(error)}`
            );
      }

      const errorText =
        error instanceof Error
          ? `${error.message} ${(error as { stderr?: string }).stderr ?? ""} ${(error as { stdout?: string }).stdout ?? ""}`
          : String(error);

      const isRateLimit = RATE_LIMIT_PATTERNS.some((p) => p.test(errorText));

      let waitMs: number;
      if (isRateLimit) {
        const retryAfter = parseRetryAfter(errorText);
        waitMs = retryAfter ?? 60_000;
        console.log(
          `  ${description}: attempt ${attempt}/${retries + 1} hit rate limit, waiting ${waitMs}ms...`
        );
      } else {
        waitMs = baseDelayMs * 2 ** (attempt - 1);
        console.log(
          `  ${description}: attempt ${attempt}/${retries + 1} failed, retrying in ${waitMs}ms...`
        );
      }

      await delay(waitMs);
    }
  }

  // Unreachable — loop always returns or throws
  throw new Error("withTestRetry: unexpected code path");
}

/**
 * Polls until a PR is visible on a given head branch.
 * Handles GitHub API eventual consistency after PR creation.
 *
 * Note: repo and headBranch are controlled test constants, not user input.
 */
export async function waitForPrVisible(
  repo: string,
  headBranch: string,
  fields = "number,title,url"
): Promise<Record<string, unknown>> {
  return withTestRetry(
    async () => {
      const result = await exec(
        `gh pr list --repo ${repo} --head ${headBranch} --json ${fields} --jq '.[0]'`
      );
      if (!result) {
        throw new Error("PR not visible yet");
      }
      const parsed = JSON.parse(result) as Record<string, unknown>;
      // GitHub API eventual consistency can return a PR with zero/default
      // field values before it's fully indexed. PR numbers are always >= 1,
      // so a zero number means the PR isn't ready yet.
      if ("number" in parsed && !parsed.number) {
        throw new Error("PR visible but number not populated yet");
      }
      return parsed;
    },
    { description: `PR on ${headBranch} visible in ${repo}` }
  );
}

/**
 * Executes a shell command with async retry for transient GitHub API errors.
 *
 * Note: All command arguments are constructed from controlled test constants
 * (owner, repoName from generateRepoName), not user input.
 */
export async function execWithRetry(
  command: string,
  options?: { cwd?: string; env?: Record<string, string | undefined> },
  retries = 3,
  delayMs = 2000
): Promise<string> {
  return withTestRetry(
    async () => {
      try {
        return await exec(command, options);
      } catch (error) {
        const err = error as {
          stderr?: string;
          stdout?: string;
          message?: string;
        };
        const errorText = `${err.message ?? ""} ${err.stderr ?? ""} ${err.stdout ?? ""}`;
        const isTransient = TRANSIENT_ERROR_PATTERNS.some((p) =>
          p.test(errorText)
        );
        if (!isTransient) {
          throw Object.assign(new Error(`Permanent error: ${errorText}`), {
            permanent: true,
          });
        }
        throw error;
      }
    },
    {
      retries,
      baseDelayMs: delayMs,
      description: `exec: ${command.slice(0, 80)}`,
    }
  );
}

/**
 * Polls GitHub API until a file is visible, handling eventual consistency.
 *
 * Note: The repo and filePath are hardcoded test constants, not user input.
 */
export async function waitForFileVisible(
  repo: string,
  filePath: string,
  envOptions?: { env: Record<string, string | undefined> }
): Promise<string> {
  return withTestRetry(
    async () => {
      let content: string;
      try {
        content = await exec(
          `gh api repos/${repo}/contents/${filePath} --jq '.content' | base64 -d`,
          envOptions
        );
      } catch {
        throw new Error(`File ${filePath} not visible yet (API error)`);
      }
      if (!content || content.includes("Not Found")) {
        throw new Error(`File ${filePath} not visible yet`);
      }
      return content;
    },
    { description: `file ${filePath} visible in ${repo}` }
  );
}

/**
 * Polls GitHub API until a ruleset is visible, handling eventual consistency.
 *
 * Note: The repo is a hardcoded constant and rulesetId is from trusted API responses.
 */
export async function waitForRulesetVisible(
  repo: string,
  rulesetId: number,
  envOptions?: { env: Record<string, string | undefined> }
): Promise<void> {
  await withTestRetry(
    async () => {
      let result: string;
      try {
        result = await exec(
          `gh api repos/${repo}/rulesets --jq '.[] | select(.id == ${rulesetId}) | .id'`,
          envOptions
        );
      } catch {
        throw new Error(`Ruleset ${rulesetId} not visible yet (API error)`);
      }
      if (result.trim() !== String(rulesetId)) {
        throw new Error(`Ruleset ${rulesetId} not visible yet`);
      }
      console.log(`  Ruleset ${rulesetId} visible`);
    },
    { description: `ruleset ${rulesetId} visible in ${repo}` }
  );
}

/**
 * Waits for a file to be deleted (returns 404).
 * Useful when verifying orphan cleanup.
 *
 * Note: inverted semantics — success is when the API call throws (404 = file gone).
 */
export async function waitForFileDeleted(
  repo: string,
  filePath: string,
  envOptions?: { env: Record<string, string | undefined> }
): Promise<void> {
  await withTestRetry(
    async () => {
      try {
        await exec(
          `gh api repos/${repo}/contents/${filePath} --jq '.sha'`,
          envOptions
        );
        // If exec succeeded, file still exists — throw to trigger retry
        throw new Error(`File ${filePath} still exists`);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === `File ${filePath} still exists`
        ) {
          throw error;
        }
        // exec() threw — file is gone (404)
        console.log(`  File ${filePath} confirmed deleted`);
      }
    },
    { description: `file ${filePath} deleted in ${repo}` }
  );
}

/**
 * List all rulesets on a repo via GitHub API.
 * Note: repo is a hardcoded test constant, not user input.
 */
export async function listRulesets(
  repo: string,
  envOptions?: { env: Record<string, string | undefined> }
): Promise<Array<{ id: number; name: string }>> {
  try {
    const json = await exec(`gh api repos/${repo}/rulesets`, envOptions);
    return JSON.parse(json) as Array<{ id: number; name: string }>;
  } catch {
    return [];
  }
}

/**
 * List all labels on a repo via GitHub API.
 * Note: repo is a hardcoded test constant, not user input.
 */
export async function listLabels(
  repo: string,
  envOptions?: { env: Record<string, string | undefined> }
): Promise<Array<{ name: string; color: string }>> {
  try {
    const json = await exec(
      `gh api repos/${repo}/labels --paginate`,
      envOptions
    );
    return JSON.parse(json) as Array<{ name: string; color: string }>;
  } catch {
    return [];
  }
}

/**
 * Polls GitHub API until a commit's verification.verified field is "true".
 * Uses longer base delay (5s) since commit verification typically takes 10-30s.
 *
 * Note: The repo and sha are hardcoded test constants, not user input.
 */
export async function waitForCommitVerified(
  repo: string,
  sha: string
): Promise<void> {
  await withTestRetry(
    async () => {
      let verified: string;
      try {
        verified = await exec(
          `gh api repos/${repo}/commits/${sha} --jq '.commit.verification.verified'`
        );
      } catch {
        throw new Error(`Commit ${sha} not verified yet (API error)`);
      }
      if (verified !== "true") {
        console.log(
          `  Commit ${sha.slice(0, 7)} verified: ${verified} (waiting...)`
        );
        throw new Error(
          `Commit ${sha} not verified yet (verified=${verified})`
        );
      }
      console.log(`  Commit ${sha.slice(0, 7)} verified`);
    },
    {
      baseDelayMs: 5000,
      description: `commit ${sha.slice(0, 7)} verified in ${repo}`,
    }
  );
}

// --- Lifecycle test helpers ---
// Shared helpers for ephemeral repo tests (create/fork/migrate).
// All inputs are controlled test constants (owner, repoName from
// randomBytes), not user input. Uses the same exec() wrapper above.

/**
 * Generate a unique ephemeral repo name for lifecycle tests.
 */
export function generateRepoName(prefix = "lifecycle"): string {
  return `xfg-${prefix}-test-${Date.now()}-${randomBytes(3).toString("hex")}`;
}

/**
 * Delete an ephemeral repo. Silently ignores errors (already deleted / not found).
 */
export async function deleteRepo(
  owner: string,
  repoName: string,
  envOptions?: { env: Record<string, string | undefined> }
): Promise<void> {
  try {
    await exec(`gh repo delete --yes ${owner}/${repoName}`, envOptions);
    console.log(`  Cleaned up ${owner}/${repoName}`);
  } catch {
    console.log(
      `  Cleanup: ${owner}/${repoName} (already deleted or not found)`
    );
  }
}

/**
 * Create an ephemeral public repo under the given owner.
 * Waits for PAT permissions to propagate to the new repo before returning.
 */
export async function createRepo(
  owner: string,
  repoName: string,
  envOptions?: { env: Record<string, string | undefined> }
): Promise<void> {
  console.log(`  Creating ephemeral repo ${owner}/${repoName}...`);
  // owner and repoName are controlled test constants (from generateRepoName),
  // not user input — safe to use with exec()
  const cmd = `gh repo create ${owner}/${repoName} --public --add-readme`;
  await execWithRetry(cmd, envOptions);
  console.log(`  Created ${owner}/${repoName}`);
  await waitForRepoReady(`${owner}/${repoName}`, envOptions);
}

/**
 * Polls until fine-grained PAT permissions have propagated to a newly created repo.
 */
async function waitForRepoReady(
  repo: string,
  envOptions?: { env: Record<string, string | undefined> }
): Promise<void> {
  await withTestRetry(
    async () => {
      // The labels endpoint requires issues:write — if this succeeds,
      // all permission scopes have propagated to the new repo
      await exec(`gh api repos/${repo}/labels --jq '.[0].name'`, envOptions);
      console.log(`  Repo permissions ready`);
    },
    { retries: 4, description: `repo ${repo} permissions ready` }
  );
}

/**
 * Check whether a repo exists via the GitHub API.
 */
export async function repoExists(
  owner: string,
  repoName: string,
  envOptions?: { env: Record<string, string | undefined> }
): Promise<boolean> {
  try {
    await exec(
      `gh api repos/${owner}/${repoName} --jq '.full_name'`,
      envOptions
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Check whether a repo is a fork of a given upstream.
 */
export async function isForkedFrom(
  owner: string,
  repoName: string,
  upstreamFullName: string,
  envOptions?: { env: Record<string, string | undefined> }
): Promise<boolean> {
  try {
    const parentName = await exec(
      `gh api repos/${owner}/${repoName} --jq '.parent.full_name'`,
      envOptions
    );
    return parentName === upstreamFullName;
  } catch {
    return false;
  }
}

/**
 * Reset an ephemeral test repo to a clean state:
 * close open PRs, delete non-default branches, delete all files on main,
 * delete rulesets, and optionally delete labels.
 *
 * Note: repo is a hardcoded test constant (e.g. "spruyt-labs/xfg-sync-test-..."),
 * not user input.
 */
export async function resetTestRepo(
  repo: string,
  _options?: { deleteLabels?: boolean }
): Promise<void> {
  console.log("\n=== Resetting ephemeral repo ===\n");
  // Close open PRs
  try {
    const prs = await exec(`gh api repos/${repo}/pulls --jq '.[].number'`);
    for (const pr of prs.split("\n").filter(Boolean)) {
      await exec(
        `gh api --method PATCH repos/${repo}/pulls/${pr} -f state=closed`
      );
    }
  } catch {
    /* no PRs */
  }
  // Delete non-default branches
  try {
    const branches = await exec(
      `gh api repos/${repo}/branches --jq '.[].name'`
    );
    for (const branch of branches.split("\n").filter(Boolean)) {
      if (branch !== "main") {
        try {
          await exec(
            `gh api --method DELETE repos/${repo}/git/refs/heads/${branch}`
          );
        } catch {
          /* already gone */
        }
      }
    }
  } catch {
    /* no branches */
  }
  // Delete all files on main
  try {
    const files = await exec(`gh api repos/${repo}/contents --jq '.[].name'`);
    for (const file of files.split("\n").filter(Boolean)) {
      try {
        const sha = await exec(
          `gh api repos/${repo}/contents/${file} --jq '.sha'`
        );
        await exec(
          `gh api --method DELETE repos/${repo}/contents/${file} -f message="reset" -f sha="${sha}"`
        );
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* empty repo */
  }
  // Delete rulesets
  try {
    const rulesets = await exec(`gh api repos/${repo}/rulesets --jq '.[].id'`);
    for (const id of rulesets.split("\n").filter(Boolean)) {
      await exec(`gh api --method DELETE repos/${repo}/rulesets/${id}`);
    }
  } catch {
    /* no rulesets */
  }
  // Delete labels
  try {
    const labels = await exec(`gh api repos/${repo}/labels --jq '.[].name'`);
    for (const label of labels.split("\n").filter(Boolean)) {
      try {
        await exec(
          `gh api --method DELETE repos/${repo}/labels/${encodeURIComponent(label)}`
        );
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* no labels */
  }
  console.log("=== Reset complete ===\n");
}

/**
 * Write a YAML config file and return its path.
 */
export function writeConfig(tmpDir: string, configYaml: string): string {
  const configPath = join(
    tmpDir,
    `lifecycle-test-config-${Date.now()}-${randomBytes(3).toString("hex")}.yaml`
  );
  writeFileSync(configPath, configYaml);
  return configPath;
}
