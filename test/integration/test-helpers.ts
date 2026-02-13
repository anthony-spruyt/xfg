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

// --- Lifecycle test helpers ---
// Shared helpers for ephemeral repo tests (create/fork/migrate).
// All inputs are controlled test constants (owner, repoName from
// randomBytes), not user input. Uses the same exec() wrapper above.

/**
 * Generate a unique ephemeral repo name for lifecycle tests.
 */
export function generateRepoName(): string {
  return `xfg-lifecycle-test-${Date.now()}-${randomBytes(3).toString("hex")}`;
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
