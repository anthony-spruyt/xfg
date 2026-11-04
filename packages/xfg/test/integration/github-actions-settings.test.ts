import { test, describe, before, after, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  exec,
  execWithRetry,
  projectRoot,
  generateRepoName,
  createRepo,
  deleteRepo,
  writeConfig,
  withTestRetry,
} from "./test-helpers.js";

const OWNER = "spruyt-labs";

interface ActionsApiState {
  permissions: {
    enabled: boolean;
    allowed_actions?: string;
    sha_pinning_required?: boolean;
  };
  workflow: {
    default_workflow_permissions: string;
    can_approve_pull_request_reviews: boolean;
  };
  forkPrApproval: { approval_policy: string };
}

let repoName: string;
let testRepo: string;
let tmpDir: string;

async function api<T>(path: string): Promise<T> {
  const output = await execWithRetry(
    `gh api repos/${testRepo}/actions/${path}`
  );
  return JSON.parse(output) as T;
}

async function getState(): Promise<ActionsApiState> {
  return {
    permissions: await api("permissions"),
    workflow: await api("permissions/workflow"),
    forkPrApproval: await api("permissions/fork-pr-contributor-approval"),
  };
}

async function runSync(configPath: string, extraArgs = ""): Promise<string> {
  return exec(
    `node dist/cli.js sync --config ${configPath} ${extraArgs}`.trim(),
    { cwd: projectRoot }
  );
}

function configFor(actionsYaml: string): string {
  return writeConfig(
    tmpDir,
    `id: integration-test-actions

settings:
  actions:
${actionsYaml}

repos:
  - git: https://github.com/${testRepo}.git
`
  );
}

const SELECTED_ACTIONS = `    allowedActions: selected
    githubOwnedAllowed: true
    verifiedAllowed: false
    patternsAllowed:
      - docker/login-action@*
      - amannn/action-semantic-pull-request@*
    shaPinningRequired: true
    defaultWorkflowPermissions: read
    canApprovePullRequestReviews: false
    forkPrApprovalPolicy: all_external_contributors`;

async function resetActions(): Promise<void> {
  console.log("  Resetting Actions settings to a known state...");
  await execWithRetry(
    `gh api --method PUT repos/${testRepo}/actions/permissions -F enabled=true -f allowed_actions=all -F sha_pinning_required=false`
  );
  await execWithRetry(
    `gh api --method PUT repos/${testRepo}/actions/permissions/workflow -f default_workflow_permissions=write -F can_approve_pull_request_reviews=true`
  );
  await execWithRetry(
    `gh api --method PUT repos/${testRepo}/actions/permissions/fork-pr-contributor-approval -f approval_policy=first_time_contributors_new_to_github`
  );
  await withTestRetry(
    async () => {
      const state = await getState();
      assert.equal(state.permissions.allowed_actions, "all");
      assert.equal(state.workflow.default_workflow_permissions, "write");
    },
    { description: "Actions settings reset visible" }
  );
}

describe("GitHub Actions Settings Integration", () => {
  before(async () => {
    repoName = generateRepoName("actions-settings");
    testRepo = `${OWNER}/${repoName}`;
    tmpDir = join(tmpdir(), `xfg-actions-settings-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    await createRepo(OWNER, repoName);
  });

  after(async () => {
    await deleteRepo(OWNER, repoName);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetActions();
  });

  test("plans a repo that is not in selected mode without reading selected-actions", async () => {
    const output = await runSync(configFor(SELECTED_ACTIONS), "--dry-run");

    assert.ok(
      output.includes("DRY RUN"),
      `Expected dry-run output, got: ${output}`
    );
    assert.ok(
      output.includes("patternsAllowed"),
      `Expected patternsAllowed in the plan, got: ${output}`
    );

    const state = await getState();
    assert.equal(
      state.permissions.allowed_actions,
      "all",
      "Dry run should not apply changes"
    );
  });

  test("applies every configured field", async () => {
    await runSync(configFor(SELECTED_ACTIONS));

    await withTestRetry(
      async () => {
        const state = await getState();
        assert.equal(state.permissions.allowed_actions, "selected");
        assert.equal(state.permissions.sha_pinning_required, true);
        assert.equal(state.workflow.default_workflow_permissions, "read");
        assert.equal(state.workflow.can_approve_pull_request_reviews, false);
        assert.equal(
          state.forkPrApproval.approval_policy,
          "all_external_contributors"
        );

        const selected = await api<{
          github_owned_allowed: boolean;
          verified_allowed: boolean;
          patterns_allowed: string[];
        }>("permissions/selected-actions");
        assert.equal(selected.github_owned_allowed, true);
        assert.equal(selected.verified_allowed, false);
        assert.deepEqual([...selected.patterns_allowed].sort(), [
          "amannn/action-semantic-pull-request@*",
          "docker/login-action@*",
        ]);
      },
      {
        retries: 5,
        baseDelayMs: 3000,
        description: "Actions settings applied",
      }
    );
  });

  test("reports no changes when settings match", async () => {
    const configPath = configFor(SELECTED_ACTIONS);
    await runSync(configPath);

    await withTestRetry(
      async () => {
        const state = await getState();
        assert.equal(state.permissions.allowed_actions, "selected");
      },
      {
        retries: 5,
        baseDelayMs: 3000,
        description: "Actions settings applied before idempotency check",
      }
    );

    const output = await runSync(configPath);
    assert.ok(
      output.includes("Actions: No changes needed"),
      `Expected Actions to report no changes, got: ${output}`
    );
  });

  test("changes one field and leaves the others alone", async () => {
    await runSync(configFor(SELECTED_ACTIONS));
    await withTestRetry(
      async () => {
        const state = await getState();
        assert.equal(state.permissions.allowed_actions, "selected");
      },
      {
        retries: 5,
        baseDelayMs: 3000,
        description: "Actions settings applied before change",
      }
    );

    await runSync(
      configFor(`    allowedActions: selected
    patternsAllowed:
      - hashicorp/setup-terraform@*
    defaultWorkflowPermissions: write`)
    );

    await withTestRetry(
      async () => {
        const state = await getState();
        assert.equal(state.workflow.default_workflow_permissions, "write");
        assert.equal(state.permissions.sha_pinning_required, true);
        assert.equal(state.workflow.can_approve_pull_request_reviews, false);

        const selected = await api<{
          github_owned_allowed: boolean;
          patterns_allowed: string[];
        }>("permissions/selected-actions");
        assert.deepEqual(selected.patterns_allowed, [
          "hashicorp/setup-terraform@*",
        ]);
        assert.equal(selected.github_owned_allowed, true);
      },
      {
        retries: 5,
        baseDelayMs: 3000,
        description: "one field changed, others kept",
      }
    );
  });

  test("a repo override to allowedActions: all ignores inherited selected-actions fields", async () => {
    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-actions

settings:
  actions:
    allowedActions: selected
    githubOwnedAllowed: true
    patternsAllowed:
      - docker/login-action@*

repos:
  - git: https://github.com/${testRepo}.git
    settings:
      actions:
        allowedActions: all
        defaultWorkflowPermissions: read
`
    );

    const output = await runSync(configPath);
    assert.ok(
      output.includes("patternsAllowed") && output.includes("ignored"),
      `Expected a warning about the ignored selected-actions fields, got: ${output}`
    );

    await withTestRetry(
      async () => {
        const state = await getState();
        assert.equal(state.permissions.allowed_actions, "all");
        assert.equal(state.workflow.default_workflow_permissions, "read");
      },
      {
        retries: 5,
        baseDelayMs: 3000,
        description: "override applied without selected-actions",
      }
    );
  });
});
