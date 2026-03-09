import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const projectRoot = join(__dirname, "../..");

/**
 * Execute a shell command and return output.
 * This helper is only used in integration tests with hardcoded commands.
 * The commands are controlled and not derived from external/user input.
 */
export function exec(
  command: string,
  options?: { cwd?: string; env?: Record<string, string | undefined> }
): string {
  try {
    return execSync(command, {
      // codeql-disable-next-line js/shell-command-injection-from-environment
      cwd: options?.cwd ?? projectRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      ...(options?.env && { env: { ...process.env, ...options.env } }),
    }).trim();
  } catch (error) {
    const err = error as { stderr?: string; stdout?: string };
    console.error("Command failed:", command);
    console.error("stderr:", err.stderr);
    console.error("stdout:", err.stdout);
    throw error;
  }
}

/**
 * Transient HTTP error patterns from the GitHub API that warrant a retry.
 */
const TRANSIENT_ERROR_PATTERNS = [
  /502/i,
  /503/i,
  /504/i,
  /500/i,
  /Server Error/i,
  /Service Unavailable/i,
];

/**
 * Executes a shell command with synchronous retry for transient GitHub API errors.
 * Uses Atomics.wait for synchronous sleep (same approach as waitForRepoReady).
 *
 * Note: All command arguments are constructed from controlled test constants
 * (owner, repoName from generateRepoName), not user input.
 */
export function execWithRetry(
  command: string,
  options?: { cwd?: string; env?: Record<string, string | undefined> },
  retries = 3,
  delayMs = 2000
): string {
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return exec(command, options);
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

      if (!isTransient || attempt > retries) {
        throw error;
      }

      const backoff = delayMs * attempt;
      console.log(
        `  Transient error on attempt ${attempt}/${retries + 1}, retrying in ${backoff}ms...`
      );
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, backoff);
    }
  }

  // Unreachable — loop always throws on final attempt failure
  throw new Error("execWithRetry: unexpected code path");
}

/**
 * Polls GitHub API until a file is visible, handling eventual consistency.
 * This prevents flaky tests where a newly pushed file isn't immediately
 * visible through the contents API.
 *
 * Note: The repo and filePath are hardcoded test constants, not user input.
 */
export async function waitForFileVisible(
  repo: string,
  filePath: string,
  timeoutMs = 10000,
  envOptions?: { env: Record<string, string | undefined> }
): Promise<string> {
  const startTime = Date.now();
  const pollInterval = 500;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const content = exec(
        `gh api repos/${repo}/contents/${filePath} --jq '.content' | base64 -d`,
        envOptions
      );
      if (content && !content.includes("Not Found")) {
        console.log(
          `  File ${filePath} visible after ${Date.now() - startTime}ms`
        );
        return content;
      }
    } catch {
      // API call failed, continue polling
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(
    `File ${filePath} not visible in ${repo} after ${timeoutMs}ms (GitHub API eventual consistency)`
  );
}

/**
 * Polls GitHub API until a ruleset is visible, handling eventual consistency.
 * This prevents flaky tests where a newly created ruleset isn't immediately
 * visible in the list endpoint.
 *
 * Note: The repo is a hardcoded constant and rulesetId is from trusted API responses.
 */
export async function waitForRulesetVisible(
  repo: string,
  rulesetId: number,
  timeoutMs = 30000,
  envOptions?: { env: Record<string, string | undefined> }
): Promise<void> {
  const startTime = Date.now();
  const pollInterval = 500;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const result = exec(
        `gh api repos/${repo}/rulesets --jq '.[] | select(.id == ${rulesetId}) | .id'`,
        envOptions
      );
      if (result.trim() === String(rulesetId)) {
        console.log(
          `  Ruleset ${rulesetId} visible after ${Date.now() - startTime}ms`
        );
        return;
      }
    } catch {
      // API call failed, continue polling
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(
    `Ruleset ${rulesetId} not visible in ${repo} after ${timeoutMs}ms (GitHub API eventual consistency)`
  );
}

/**
 * Waits for a file to be deleted (returns 404).
 * Useful when verifying orphan cleanup.
 */
export async function waitForFileDeleted(
  repo: string,
  filePath: string,
  timeoutMs = 10000,
  envOptions?: { env: Record<string, string | undefined> }
): Promise<void> {
  const startTime = Date.now();
  const pollInterval = 500;

  while (Date.now() - startTime < timeoutMs) {
    try {
      exec(`gh api repos/${repo}/contents/${filePath} --jq '.sha'`, envOptions);
      // File still exists, continue polling
    } catch {
      // 404 - file is deleted
      console.log(
        `  File ${filePath} confirmed deleted after ${Date.now() - startTime}ms`
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(
    `File ${filePath} still exists in ${repo} after ${timeoutMs}ms`
  );
}

/**
 * List all rulesets on a repo via GitHub API.
 * Note: repo is a hardcoded test constant, not user input.
 */
export function listRulesets(
  repo: string,
  envOptions?: { env: Record<string, string | undefined> }
): Array<{ id: number; name: string }> {
  try {
    const json = exec(`gh api repos/${repo}/rulesets`, envOptions);
    return JSON.parse(json) as Array<{ id: number; name: string }>;
  } catch {
    return [];
  }
}

/**
 * List all labels on a repo via GitHub API.
 * Note: repo is a hardcoded test constant, not user input.
 */
export function listLabels(
  repo: string,
  envOptions?: { env: Record<string, string | undefined> }
): Array<{ name: string; color: string }> {
  try {
    const json = exec(`gh api repos/${repo}/labels --paginate`, envOptions);
    return JSON.parse(json) as Array<{ name: string; color: string }>;
  } catch {
    return [];
  }
}

/**
 * Polls GitHub API until a commit's verification.verified field is "true".
 * GitHub's API has eventual consistency — verification metadata may lag.
 *
 * Note: The repo and sha are hardcoded test constants, not user input.
 */
export async function waitForCommitVerified(
  repo: string,
  sha: string,
  timeoutMs = 120000
): Promise<void> {
  const startTime = Date.now();
  const pollInterval = 5000;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const verified = exec(
        `gh api repos/${repo}/commits/${sha} --jq '.commit.verification.verified'`
      );
      if (verified === "true") {
        console.log(
          `  Commit ${sha.slice(0, 7)} verified after ${Date.now() - startTime}ms`
        );
        return;
      }
      console.log(
        `  Commit ${sha.slice(0, 7)} verified: ${verified} (waiting...)`
      );
    } catch {
      // API call failed, continue polling
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Commit ${sha} not verified in ${repo} after ${timeoutMs}ms`);
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
export function deleteRepo(
  owner: string,
  repoName: string,
  envOptions?: { env: Record<string, string | undefined> }
): void {
  try {
    exec(`gh repo delete --yes ${owner}/${repoName}`, envOptions);
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
export function createRepo(
  owner: string,
  repoName: string,
  envOptions?: { env: Record<string, string | undefined> }
): void {
  console.log(`  Creating ephemeral repo ${owner}/${repoName}...`);
  // owner and repoName are controlled test constants (from generateRepoName),
  // not user input — safe to use with exec()
  const cmd = `gh repo create ${owner}/${repoName} --public --add-readme`;
  execWithRetry(cmd, envOptions);
  console.log(`  Created ${owner}/${repoName}`);
  waitForRepoReady(`${owner}/${repoName}`, envOptions);
}

/**
 * Polls until fine-grained PAT permissions have propagated to a newly created repo.
 * When a fine-grained PAT is scoped to "All repositories", permissions like
 * issues:write and pull_requests:write may take seconds to propagate to
 * dynamically created repos, even though administration and contents scopes
 * are available immediately.
 */
function waitForRepoReady(
  repo: string,
  envOptions?: { env: Record<string, string | undefined> },
  timeoutMs = 30000,
  pollMs = 2000
): void {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      // The labels endpoint requires issues:write — if this succeeds,
      // all permission scopes have propagated to the new repo
      exec(`gh api repos/${repo}/labels --jq '.[0].name'`, envOptions);
      console.log(`  Repo permissions ready after ${Date.now() - startTime}ms`);
      return;
    } catch {
      // Permission not yet propagated, continue polling
    }
    // Synchronous sleep — Atomics.wait on a dummy SharedArrayBuffer
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pollMs);
  }

  throw new Error(
    `Repo ${repo} permissions not ready after ${timeoutMs}ms — check PAT repository scope`
  );
}

/**
 * Check whether a repo exists via the GitHub API.
 */
export function repoExists(
  owner: string,
  repoName: string,
  envOptions?: { env: Record<string, string | undefined> }
): boolean {
  try {
    exec(`gh api repos/${owner}/${repoName} --jq '.full_name'`, envOptions);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check whether a repo is a fork of a given upstream.
 */
export function isForkedFrom(
  owner: string,
  repoName: string,
  upstreamFullName: string,
  envOptions?: { env: Record<string, string | undefined> }
): boolean {
  try {
    const parentName = exec(
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
export function resetTestRepo(
  repo: string,
  _options?: { deleteLabels?: boolean }
): void {
  console.log("\n=== Resetting ephemeral repo ===\n");
  // Close open PRs
  try {
    const prs = exec(`gh api repos/${repo}/pulls --jq '.[].number'`);
    for (const pr of prs.split("\n").filter(Boolean)) {
      exec(`gh api --method PATCH repos/${repo}/pulls/${pr} -f state=closed`);
    }
  } catch {
    /* no PRs */
  }
  // Delete non-default branches
  try {
    const branches = exec(`gh api repos/${repo}/branches --jq '.[].name'`);
    for (const branch of branches.split("\n").filter(Boolean)) {
      if (branch !== "main") {
        try {
          exec(`gh api --method DELETE repos/${repo}/git/refs/heads/${branch}`);
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
    const files = exec(`gh api repos/${repo}/contents --jq '.[].name'`);
    for (const file of files.split("\n").filter(Boolean)) {
      try {
        const sha = exec(`gh api repos/${repo}/contents/${file} --jq '.sha'`);
        exec(
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
    const rulesets = exec(`gh api repos/${repo}/rulesets --jq '.[].id'`);
    for (const id of rulesets.split("\n").filter(Boolean)) {
      exec(`gh api --method DELETE repos/${repo}/rulesets/${id}`);
    }
  } catch {
    /* no rulesets */
  }
  // Delete labels
  try {
    const labels = exec(`gh api repos/${repo}/labels --jq '.[].name'`);
    for (const label of labels.split("\n").filter(Boolean)) {
      try {
        exec(
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
