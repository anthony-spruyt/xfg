import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import Bottleneck from "bottleneck";

const execFileAsync = promisify(execFile);

export type RequestClass = "read" | "write" | "create" | "cli" | "external";

type PacedClass = Exclude<RequestClass, "cli" | "external">;

// Per test process; up to 8 lanes share GH_PAT_ORG. Per lane, helper calls get 100 secondary-limit
// points/min (of GitHub's 900) and 10 creations/min (of 80); xfg's own requests come on top.
const limiters: Record<PacedClass, Bottleneck> = {
  read: new Bottleneck({ maxConcurrent: 2, minTime: 500 }),
  write: new Bottleneck({ maxConcurrent: 1, minTime: 1000 }),
  create: new Bottleneck({
    maxConcurrent: 1,
    minTime: 1000,
    reservoir: 3,
    reservoirIncreaseAmount: 1,
    reservoirIncreaseInterval: 6000,
    reservoirIncreaseMaximum: 3,
  }),
};
const pointsBudget = new Bottleneck({
  reservoir: 40,
  reservoirIncreaseAmount: 1,
  // Bottleneck refills on a 250ms heartbeat, so the interval must be a multiple of it
  reservoirIncreaseInterval: 500,
  reservoirIncreaseMaximum: 40,
});

/** Cost of a request against GitHub's secondary rate limit (GET 1, mutation 5). */
export function secondaryLimitPoints(requestClass: RequestClass): number {
  if (requestClass === "cli" || requestClass === "external") return 0;
  return requestClass === "read" ? 1 : 5;
}

const READ_SUBCOMMANDS = new Set(["list", "view", "status", "checks", "diff"]);
const CREATE_SUBCOMMANDS = new Set(["create", "fork", "comment"]);

/**
 * Classify a command for pacing: GitHub reads, mutations and content-creating mutations
 * (POST/PUT) are paced; xfg CLI runs and other tools (az, glab, curl, scripts) are not.
 */
export function classifyCommand(command: string): RequestClass {
  const words = command.trim().split(/\s+/);
  if (words[0] === "node" && words[1]?.endsWith("cli.js")) return "cli";
  if (words[0] !== "gh") return "external";
  if (words[1] !== "api") {
    const sub = words[2] ?? "";
    if (READ_SUBCOMMANDS.has(sub)) return "read";
    return CREATE_SUBCOMMANDS.has(sub) ? "create" : "write";
  }
  if (words[2] === "graphql") {
    return /\bmutation\b/.test(command) ? "write" : "read";
  }
  const method = /(?:--method[\s=]|-X\s*)([A-Za-z]+)/.exec(command)?.[1];
  const verb =
    method?.toUpperCase() ??
    (/\s(?:-f|-F|--field|--raw-field|--input)[\s=]/.test(command)
      ? "POST"
      : "GET");
  if (verb === "GET") return "read";
  return verb === "POST" || verb === "PUT" ? "create" : "write";
}

interface RequestStats {
  read: number;
  write: number;
  create: number;
  cli: number;
  external: number;
  queueWaitMs: number;
  maxQueueWaitMs: number;
  rateLimitHits: number;
}

const stats: RequestStats = {
  read: 0,
  write: 0,
  create: 0,
  cli: 0,
  external: 0,
  queueWaitMs: 0,
  maxQueueWaitMs: 0,
  rateLimitHits: 0,
};

export function formatRequestStats(label: string, s: RequestStats): string {
  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  return [
    `#### Requests: ${label}`,
    "",
    "| Class | Count |",
    "| --- | --- |",
    `| read | ${s.read} |`,
    `| write | ${s.write} |`,
    `| create | ${s.create} |`,
    `| cli | ${s.cli} |`,
    `| external | ${s.external} |`,
    "",
    `Limiter queue wait: ${seconds(s.queueWaitMs)} total, ${seconds(s.maxQueueWaitMs)} max. Rate-limit hits: ${s.rateLimitHits}.`,
    "",
  ].join("\n");
}

process.once("exit", () => {
  const total =
    stats.read + stats.write + stats.create + stats.cli + stats.external;
  if (total === 0) return;
  const shard = process.env.XFG_TEST_SHARD;
  const label = `${basename(process.argv[1] ?? "unknown")}${shard ? ` (shard ${shard})` : ""}`;
  const text = formatRequestStats(label, stats);
  process.stderr.write(`\n${text}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  }
});

/**
 * Whether test number `index` (0-based, in file order) runs in this shard.
 * `shard` is XFG_TEST_SHARD, e.g. "1/2"; tests are dealt round-robin.
 */
export function inShard(index: number, shard: string | undefined): boolean {
  if (!shard) return true;
  const match = /^(\d+)\/(\d+)$/.exec(shard);
  const part = Number(match?.[1]);
  const total = Number(match?.[2]);
  if (!match || total < 1 || part < 1 || part > total) {
    throw new Error(`XFG_TEST_SHARD must look like 1/2, got "${shard}"`);
  }
  return index % total === part - 1;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const projectRoot = join(__dirname, "../..");

// The npm package sits at packages/xfg, but .github/ stays at the repo root.
export const repoRoot = join(projectRoot, "../..");

/**
 * Execute a shell command and return output.
 * This helper is only used in integration tests with hardcoded commands.
 * The commands are controlled and not derived from external/user input.
 * Commands are paced per request class (see classifyCommand).
 *
 * Note: Uses execFile("sh", ["-c", command]) which requires shell features
 * (pipes, env expansion). All command arguments are controlled test constants
 * (repo names from generateRepoName, hardcoded field names), never external input.
 */
export async function exec(
  command: string,
  options?: {
    cwd?: string;
    env?: Record<string, string | undefined>;
    quiet?: boolean;
  }
): Promise<string> {
  const requestClass = classifyCommand(command);
  const queuedAt = Date.now();
  const run = async (): Promise<string> => {
    const waitMs = Date.now() - queuedAt;
    stats[requestClass]++;
    stats.queueWaitMs += waitMs;
    stats.maxQueueWaitMs = Math.max(stats.maxQueueWaitMs, waitMs);
    try {
      const { stdout } = await execFileAsync("sh", ["-c", command], {
        cwd: options?.cwd ?? projectRoot,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
        ...(options?.env && { env: { ...process.env, ...options.env } }),
      });
      return stdout.trim();
    } catch (error) {
      if (!options?.quiet) {
        const err = error as { stderr?: string; stdout?: string };
        console.error("Command failed:", command);
        console.error("stderr:", err.stderr);
        console.error("stdout:", err.stdout);
      }
      throw error;
    }
  };
  if (requestClass === "cli" || requestClass === "external") return run();
  const weight = secondaryLimitPoints(requestClass);
  return limiters[requestClass].schedule(() =>
    pointsBudget.schedule({ weight }, run)
  );
}

// Status codes must follow an HTTP/status prefix: bare digits also match
// the Date.now() timestamps in generateRepoName() repo names.
const HTTP_429 = /(?:HTTP(?:\/[\d.]+)?|status(?:\s+code)?:?)\s*429\b/i;
const HTTP_5XX = /(?:HTTP(?:\/[\d.]+)?|status(?:\s+code)?:?)\s*50[0234]\b/i;

/**
 * Transient HTTP error patterns from the GitHub API that warrant a retry.
 */
const TRANSIENT_ERROR_PATTERNS = [
  HTTP_5XX,
  /Server Error/i,
  /Service Unavailable/i,
  /Bad Gateway/i,
  /rate limit/i,
  /secondary rate/i,
  /abuse detection/i,
  /too many requests/i,
  /retry-after/i,
  HTTP_429,
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
  HTTP_429,
];

export function isTransientErrorText(text: string): boolean {
  return TRANSIENT_ERROR_PATTERNS.some((p) => p.test(text));
}

export function isRateLimitText(text: string): boolean {
  return RATE_LIMIT_PATTERNS.some((p) => p.test(text));
}

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

      const isRateLimit = isRateLimitText(errorText);

      let waitMs: number;
      if (isRateLimit) {
        stats.rateLimitHits++;
        const retryAfter = parseRetryAfter(errorText);
        waitMs = retryAfter ?? 60_000;
        console.log(
          `::warning title=Rate limited::${description}: attempt ${attempt}/${retries + 1} hit a rate limit at ${new Date().toISOString()}, waiting ${waitMs}ms`
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
  options?: {
    cwd?: string;
    env?: Record<string, string | undefined>;
    quiet?: boolean;
  },
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
        const isTransient = isTransientErrorText(errorText);
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
 * True only for a 404 from gh/az/glab/curl. Any other failure (5xx, rate
 * limit, auth) must not be mistaken for "resource absent".
 */
export function isNotFoundError(error: unknown): boolean {
  const err = error as { message?: string; stderr?: string; stdout?: string };
  const text = `${err?.message ?? ""} ${err?.stderr ?? ""} ${err?.stdout ?? ""}`;
  return /HTTP 404|Not Found/i.test(text);
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
        throw new Error(`File ${filePath} still exists`);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === `File ${filePath} still exists`
        ) {
          throw error;
        }
        if (!isNotFoundError(error)) {
          throw error;
        }
        console.log(`  File ${filePath} confirmed deleted`);
      }
    },
    { description: `file ${filePath} deleted in ${repo}` }
  );
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
 * Check whether a repo exists, retrying transient failures to handle GitHub's
 * eventual consistency (e.g. repo was just created and may not be visible yet).
 * Use this when asserting a repo SHOULD exist.
 */
export async function repoExists(
  owner: string,
  repoName: string,
  envOptions?: { env: Record<string, string | undefined> }
): Promise<boolean> {
  try {
    await withTestRetry(
      () =>
        exec(`gh api repos/${owner}/${repoName} --jq '.full_name'`, {
          ...envOptions,
          quiet: true,
        }),
      { description: `repo ${owner}/${repoName} visible` }
    );
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

/**
 * Check whether a repo exists without waiting for a 404 to change.
 * Use this when asserting a repo should NOT exist (e.g. after a dry-run),
 * where a 404 is the expected outcome. Transient errors are still retried.
 */
export async function repoExistsNoRetry(
  owner: string,
  repoName: string,
  envOptions?: { env: Record<string, string | undefined> }
): Promise<boolean> {
  try {
    await execWithRetry(`gh api repos/${owner}/${repoName} --jq '.full_name'`, {
      ...envOptions,
      quiet: true,
    });
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

/**
 * Check whether a repo is a fork of a given upstream.
 * API errors propagate so a failed lookup never reads as "not a fork".
 */
export async function isForkedFrom(
  owner: string,
  repoName: string,
  upstreamFullName: string,
  envOptions?: { env: Record<string, string | undefined> }
): Promise<boolean> {
  const parentName = await execWithRetry(
    `gh api repos/${owner}/${repoName} --jq '.parent.full_name'`,
    envOptions
  );
  return parentName === upstreamFullName;
}

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

async function listOrEmpty(
  run: (command: string) => Promise<string>,
  command: string
): Promise<string[]> {
  try {
    return (await run(command)).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Reset an ephemeral test repo to a clean state: delete rulesets, close open
 * PRs, delete non-default branches, and empty main in one commit. Labels are
 * kept unless `deleteLabels` is set.
 *
 * Note: repo is a hardcoded test constant (e.g. "spruyt-labs/xfg-sync-test-..."),
 * not user input.
 */
export async function resetTestRepo(
  repo: string,
  options: { deleteLabels?: boolean } = {},
  run: (command: string) => Promise<string> = (command) =>
    execWithRetry(command, { quiet: true })
): Promise<void> {
  console.log("\n=== Resetting ephemeral repo ===\n");
  const [rulesets, prs, branches, labels, head] = await Promise.all([
    listOrEmpty(run, `gh api repos/${repo}/rulesets --jq '.[].id'`),
    listOrEmpty(run, `gh api repos/${repo}/pulls --jq '.[].number'`),
    listOrEmpty(run, `gh api repos/${repo}/branches --jq '.[].name'`),
    options.deleteLabels
      ? listOrEmpty(run, `gh api repos/${repo}/labels --jq '.[].name'`)
      : Promise.resolve([]),
    run(
      `gh api repos/${repo}/branches/main --jq '.commit.sha + " " + .commit.commit.tree.sha'`
    ),
  ]);

  // Rulesets first: they can block the branch deletes and the update to main
  const cleanup = [
    ...rulesets.map(
      (id) => `gh api --method DELETE repos/${repo}/rulesets/${id}`
    ),
    ...prs.map(
      (pr) => `gh api --method PATCH repos/${repo}/pulls/${pr} -f state=closed`
    ),
    ...branches
      .filter((branch) => branch !== "main")
      .map(
        (branch) =>
          `gh api --method DELETE repos/${repo}/git/refs/heads/${branch}`
      ),
    ...labels.map(
      (label) =>
        `gh api --method DELETE repos/${repo}/labels/${encodeURIComponent(label)}`
    ),
  ];
  for (const command of cleanup) {
    try {
      await run(command);
    } catch {
      /* already gone */
    }
  }

  const [headSha, treeSha] = head.split(" ");
  if (treeSha !== EMPTY_TREE) {
    const commitSha = await run(
      `gh api --method POST repos/${repo}/git/commits -f message=reset -f tree=${EMPTY_TREE} -f 'parents[]=${headSha}' --jq '.sha'`
    );
    await run(
      `gh api --method PATCH repos/${repo}/git/refs/heads/main -f sha=${commitSha}`
    );
  }
  console.log("=== Reset complete ===\n");
}

export function writeConfig(tmpDir: string, configYaml: string): string {
  const configPath = join(
    tmpDir,
    `lifecycle-test-config-${Date.now()}-${randomBytes(3).toString("hex")}.yaml`
  );
  writeFileSync(configPath, configYaml);
  return configPath;
}
