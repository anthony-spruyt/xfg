import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../.."
);
const PREFLIGHT = ".github/scripts/require-env-secrets.sh";

interface Step {
  name?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
}

interface Job {
  environment?: { name: string } | string;
  "timeout-minutes"?: number;
  steps: Step[];
}

function jobs(workflow: string): [string, Job][] {
  const parsed = parse(
    readFileSync(join(repoRoot, ".github/workflows", workflow), "utf-8")
  ) as { jobs: Record<string, Job> };
  return Object.entries(parsed.jobs);
}

function secretsUsed(steps: Step[]): Set<string> {
  const names = new Set<string>();
  for (const step of steps) {
    const values = [
      ...Object.values(step.env ?? {}),
      ...Object.values(step.with ?? {}),
    ];
    for (const value of values) {
      for (const match of String(value).matchAll(/secrets\.([A-Z0-9_]+)/g)) {
        names.add(match[1]);
      }
    }
  }
  return names;
}

const environmentJobs = [
  ...jobs("_integration-tests.yaml"),
  ...jobs("cleanup-test-repos.yaml"),
].filter(([, job]) => job.environment !== undefined);

describe("environment-gated jobs", () => {
  test("exist", () => {
    assert.ok(environmentJobs.length >= 7, "expected 5 lanes + 2 cleanups");
  });

  for (const [name, job] of environmentJobs) {
    test(`${name} checks its environment secrets before using them`, () => {
      const index = job.steps.findIndex((step) =>
        step.run?.includes(PREFLIGHT)
      );
      assert.ok(index >= 0, `${name} has no preflight step`);

      const firstSecretUse = job.steps.findIndex(
        (step, i) => i !== index && secretsUsed([step]).size > 0
      );
      assert.ok(
        index < firstSecretUse,
        `${name}: preflight must run before the first step using a secret`
      );

      const preflight = job.steps[index];
      const checked = secretsUsed([preflight]);
      // Repo-level secret passed by ci.yaml, not an environment secret
      const used = secretsUsed(job.steps.slice(index + 1));
      used.delete("AZURE_DEVOPS_EXT_PAT");
      for (const secret of used) {
        assert.ok(checked.has(secret), `${name}: preflight skips ${secret}`);
        assert.equal(
          preflight.env?.[secret],
          `\${{ secrets.${secret} }}`,
          `${name}: ${secret} must be passed under its own name`
        );
        assert.match(
          preflight.run ?? "",
          new RegExp(`\\b${secret}\\b`),
          `${name}: preflight does not name ${secret}`
        );
      }
    });
  }
});

describe("integration lanes", () => {
  for (const [name, job] of jobs("_integration-tests.yaml")) {
    test(`${name} has a timeout`, () => {
      assert.ok(
        Number.isInteger(job["timeout-minutes"]),
        `${name} has no timeout-minutes`
      );
    });
  }
});
