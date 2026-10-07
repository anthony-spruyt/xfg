import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
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
  environment?: { name: string; deployment?: boolean } | string;
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
    assert.ok(environmentJobs.length >= 9, "expected 7 lanes + 2 cleanups");
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
      const used = secretsUsed(job.steps.slice(index + 1));
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

const EXTERNAL_PLATFORM_SECRETS = ["AZURE_DEVOPS_EXT_PAT", "GITLAB_TOKEN"];
// Reusable lanes take the environment as an input; standalone workflows run on main only
const GATED_ENVIRONMENTS = ["${{ inputs.environment }}", "integration-main"];

describe("ADO and GitLab credentials", () => {
  const workflowFiles = readdirSync(join(repoRoot, ".github/workflows"))
    .filter((file) => /\.ya?ml$/.test(file))
    .sort();
  const readers = workflowFiles.flatMap((file) =>
    jobs(file)
      // Jobs that call a reusable workflow have no steps
      .filter(([, job]) => Array.isArray(job.steps))
      .map(([name, job]): [string, Job, string[]] => [
        `${file}: ${name}`,
        job,
        EXTERNAL_PLATFORM_SECRETS.filter((secret) =>
          secretsUsed(job.steps).has(secret)
        ),
      ])
      .filter(([, , secrets]) => secrets.length > 0)
  );

  test("are read by the ADO, GitLab and lifecycle lanes", () => {
    const names = readers.map(([name]) => name);
    for (const lane of [
      "integration-test-cli-sync-ado-pat",
      "integration-test-cli-sync-gitlab-pat",
      "integration-test-github-lifecycle",
    ]) {
      assert.ok(
        names.includes(`_integration-tests.yaml: ${lane}`),
        `${lane} no longer reads ADO/GitLab credentials`
      );
    }
  });

  for (const [name, job, secrets] of readers) {
    test(`${name} reads ${secrets.join(", ")} only behind the integration environment`, () => {
      assert.ok(
        typeof job.environment === "object" &&
          GATED_ENVIRONMENTS.includes(job.environment.name) &&
          job.environment.deployment === false,
        `${name} must run in the integration environment with deployment: false`
      );

      const preflight = job.steps.find((step) => step.run?.includes(PREFLIGHT));
      assert.ok(preflight, `${name} has no preflight step`);
      for (const secret of secrets) {
        assert.equal(
          preflight.env?.[secret],
          `\${{ secrets.${secret} }}`,
          `${name}: preflight does not receive ${secret}`
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

interface Workflow {
  on: { workflow_call?: { secrets?: Record<string, unknown> } };
  jobs: Record<string, Job & { secrets?: Record<string, string> }>;
}

function workflow(name: string): Workflow {
  return parse(
    readFileSync(join(repoRoot, ".github/workflows", name), "utf-8")
  ) as Workflow;
}

describe("integration workflow secrets", () => {
  const called = workflow("_integration-tests.yaml");
  const declared = Object.keys(called.on.workflow_call?.secrets ?? {});
  const passed = workflow("ci.yaml").jobs["integration-tests"].secrets ?? {};

  test("every secret the lanes use is declared", () => {
    const used = new Set<string>();
    for (const job of Object.values(called.jobs)) {
      for (const secret of secretsUsed(job.steps)) used.add(secret);
    }
    for (const secret of used) {
      assert.ok(declared.includes(secret), `${secret} is not declared`);
    }
  });

  // A called workflow only sees secrets its caller passes, environment secrets included
  for (const secret of declared) {
    test(`ci.yaml passes ${secret} by name`, () => {
      assert.equal(passed[secret], `\${{ secrets.${secret} }}`);
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
