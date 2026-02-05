import { execSync } from "node:child_process";
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
export function exec(command: string, options?: { cwd?: string }): string {
  try {
    return execSync(command, {
      // codeql-disable-next-line js/shell-command-injection-from-environment
      cwd: options?.cwd ?? projectRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
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
  timeoutMs = 10000
): Promise<string> {
  const startTime = Date.now();
  const pollInterval = 500;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const content = exec(
        `gh api repos/${repo}/contents/${filePath} --jq '.content' | base64 -d`
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
  timeoutMs = 30000
): Promise<void> {
  const startTime = Date.now();
  const pollInterval = 500;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const result = exec(
        `gh api repos/${repo}/rulesets --jq '.[] | select(.id == ${rulesetId}) | .id'`
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
  timeoutMs = 10000
): Promise<void> {
  const startTime = Date.now();
  const pollInterval = 500;

  while (Date.now() - startTime < timeoutMs) {
    try {
      exec(`gh api repos/${repo}/contents/${filePath} --jq '.sha'`);
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
