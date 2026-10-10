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
  env?: Record<string, string>;
  steps: Step[];
}

function jobs(workflow: string): [string, Job][] {
  const parsed = parse(
    readFileSync(join(repoRoot, ".github/workflows", workflow), "utf-8")
  ) as { jobs: Record<string, Job> };
  return Object.entries(parsed.jobs);
}

const SECRET_REF =
  /secrets(?:\.([A-Za-z0-9_]+)|\[\s*['"]([A-Za-z0-9_]+)['"]\s*\])/g;

function secretRefs(text: string): string[] {
  return [...text.matchAll(SECRET_REF)].map((match) => match[1] ?? match[2]);
}

function secretsUsed(steps: Step[]): Set<string> {
  const names = new Set<string>();
  for (const step of steps) {
    const values = [
      ...Object.values(step.env ?? {}),
      ...Object.values(step.with ?? {}),
    ];
    for (const value of values) {
      for (const name of secretRefs(String(value))) names.add(name);
    }
  }
  return names;
}

function strings(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (node === null || typeof node !== "object") return [];
  return Object.values(node).flatMap(strings);
}

// `secrets: inherit` hands every secret to a reusable workflow, so it reads them all
function reads(node: unknown, secret: string): boolean {
  if ((node as { secrets?: unknown } | undefined)?.secrets === "inherit") {
    return true;
  }
  return strings(node).some((value) => secretRefs(value).includes(secret));
}

describe("secret reference matching", () => {
  for (const [name, node] of Object.entries({
    "dot syntax": { env: { A: "${{ secrets.GITLAB_TOKEN }}" } },
    "single-quoted index": { env: { A: "${{ secrets['GITLAB_TOKEN'] }}" } },
    "double-quoted index": { env: { A: '${{ secrets[ "GITLAB_TOKEN" ] }}' } },
    "secrets: inherit": {
      uses: "./.github/workflows/x.yaml",
      secrets: "inherit",
    },
  })) {
    test(`reads() sees ${name}`, () => {
      assert.equal(reads(node, "GITLAB_TOKEN"), true);
    });
  }

  test("reads() ignores other secrets", () => {
    assert.equal(
      reads({ env: { A: "${{ secrets['GITLAB_TOKEN_2'] }}" } }, "GITLAB_TOKEN"),
      false
    );
  });

  test("secretsUsed() sees index syntax", () => {
    assert.deepEqual(
      [...secretsUsed([{ env: { A: "${{ secrets['GH_PAT_ORG'] }}" } }])],
      ["GH_PAT_ORG"]
    );
  });
});

const environmentJobs = [
  ...jobs("_integration-tests.yaml"),
  ...jobs("cleanup-test-repos.yaml"),
].filter(([, job]) => job.environment !== undefined);

describe("environment-gated jobs", () => {
  test("exist", () => {
    assert.ok(environmentJobs.length >= 11, "expected 9 lanes + 2 cleanups");
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

interface CallerJob {
  uses?: string;
  secrets?: unknown;
}

function inheritsIntoRemote(job: CallerJob): boolean {
  return job.secrets === "inherit" && !job.uses?.startsWith("./");
}

describe("inherited secrets", () => {
  test("into a workflow outside this repo count as reads", () => {
    assert.equal(
      inheritsIntoRemote({
        uses: "o/r/.github/workflows/x.yaml@sha",
        secrets: "inherit",
      }),
      true
    );
  });

  test("into a local workflow are checked through its own jobs", () => {
    assert.equal(
      inheritsIntoRemote({
        uses: "./.github/workflows/ci-repo.yaml",
        secrets: "inherit",
      }),
      false
    );
  });
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
      // Jobs that call a reusable workflow have no steps; the called jobs are checked
      // instead, unless the caller inherits secrets into a workflow outside this repo
      .filter(
        ([, job]) =>
          Array.isArray(job.steps) || inheritsIntoRemote(job as CallerJob)
      )
      .map(([name, job]): [string, Job, string[]] => [
        `${file}: ${name}`,
        job,
        EXTERNAL_PLATFORM_SECRETS.filter((secret) => reads(job, secret)),
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

      const steps = job.steps ?? [];
      const index = steps.findIndex((step) => step.run?.includes(PREFLIGHT));
      assert.ok(index >= 0, `${name} has no preflight step`);
      const preflight = steps[index];
      for (const secret of secrets) {
        assert.ok(
          !reads(job.env, secret),
          `${name}: ${secret} must not be in job-level env, which runs before the preflight`
        );
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
        const firstUse = steps.findIndex(
          (step, i) => i !== index && reads(step, secret)
        );
        assert.ok(
          firstUse === -1 || index < firstUse,
          `${name}: preflight must run before the first step using ${secret}`
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
  const passed =
    workflow("ci-repo.yaml").jobs["integration-tests"].secrets ?? {};

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
    test(`ci-repo.yaml passes ${secret} by name`, () => {
      assert.equal(passed[secret], `\${{ secrets.${secret} }}`);
    });
  }
});

describe("ci.yaml", () => {
  const ci = parse(
    readFileSync(join(repoRoot, ".github/workflows/ci.yaml"), "utf-8")
  ) as {
    on: { pull_request: { types?: string[] } };
    jobs: Record<
      string,
      CallerJob & { needs?: string[]; if?: string; permissions?: unknown }
    >;
  };
  const LABEL_GUARD =
    "github.event.action != 'labeled' || github.event.label.name == 'run-integration'";
  const guards: Record<string, string> = {
    lint: LABEL_GUARD,
    repo: LABEL_GUARD,
    image: LABEL_GUARD,
    summary: `always() && (${LABEL_GUARD})`,
  };

  test("adding a label starts a run", () => {
    assert.deepEqual(ci.on.pull_request.types, [
      "opened",
      "synchronize",
      "reopened",
      "labeled",
    ]);
  });

  // Otherwise any other label posts an all-skipped green summary over the real result
  for (const name of Object.keys(ci.jobs)) {
    test(`${name} skips runs started by a label other than run-integration`, () => {
      assert.equal(ci.jobs[name].if, guards[name]);
    });
  }

  test("repo runs ci-repo.yaml after lint with inherited secrets", () => {
    const repo = ci.jobs.repo;
    assert.equal(repo.uses, "./.github/workflows/ci-repo.yaml");
    assert.deepEqual(repo.needs, ["lint"]);
    assert.equal(repo.secrets, "inherit");
    assert.deepEqual(repo.permissions, { contents: "read" });
  });

  test("image runs the shared _images.yaml after lint and repo", () => {
    const image = ci.jobs.image;
    assert.match(
      image.uses ?? "",
      /^anthony-spruyt\/repo-operator\/\.github\/workflows\/_images\.yaml@[0-9a-f]{40}$/
    );
    assert.deepEqual(image.needs, ["lint", "repo"]);
    assert.deepEqual(image.permissions, { contents: "read" });
  });

  test("summary judges lint, repo and image even when they fail", () => {
    assert.deepEqual(ci.jobs.summary.needs, ["lint", "repo", "image"]);
    assert.match(ci.jobs.summary.if ?? "", /^always\(\) && /);
  });

  test("has only the lint, repo, image and summary jobs", () => {
    assert.deepEqual(Object.keys(ci.jobs), [
      "lint",
      "repo",
      "image",
      "summary",
    ]);
  });
});

describe("integration lanes", () => {
  const lanes = jobs("_integration-tests.yaml");

  for (const [name, job] of lanes) {
    test(`${name} has a timeout`, () => {
      assert.ok(
        Number.isInteger(job["timeout-minutes"]),
        `${name} has no timeout-minutes`
      );
    });
  }

  const RATE_LIMIT = ".github/scripts/rate-limit-summary.sh";
  for (const [name, job] of lanes.filter(([, job]) =>
    secretsUsed(job.steps).has("GH_PAT_ORG")
  )) {
    test(`${name} records GH_PAT_ORG rate-limit headroom at start and end`, () => {
      for (const phase of ["start", "end"]) {
        assert.ok(
          job.steps.some(
            (step) =>
              step.run?.includes(`${RATE_LIMIT} ${phase} `) &&
              step.env?.GH_TOKEN === "${{ secrets.GH_PAT_ORG }}"
          ),
          `${name} has no GH_PAT_ORG rate-limit ${phase} step`
        );
      }
    });
  }

  test("sharded lanes cover every shard of their suite exactly once", () => {
    const shards = new Map<string, string[]>();
    for (const [, job] of lanes) {
      for (const step of job.steps) {
        const shard = step.env?.XFG_TEST_SHARD;
        if (!shard || !step.run) continue;
        shards.set(step.run, [...(shards.get(step.run) ?? []), shard]);
      }
    }
    assert.ok(shards.size > 0, "no lane sets XFG_TEST_SHARD");
    for (const [run, seen] of shards) {
      const total = Number(seen[0].split("/")[1]);
      const expected = Array.from(
        { length: total },
        (_, i) => `${i + 1}/${total}`
      );
      assert.deepEqual(
        [...seen].sort(),
        expected,
        `${run}: ${seen.join(", ")}`
      );
    }
  });
});
