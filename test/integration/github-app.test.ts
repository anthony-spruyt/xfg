import { test, describe, before } from "node:test";
import { strict as assert } from "node:assert";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync, existsSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "../..");
const fixturesDir = join(projectRoot, "test", "fixtures");

const TEST_REPO = "anthony-spruyt/xfg-test";
const TARGET_FILE = "github-app-test.json";
const BRANCH_NAME = "chore/sync-github-app-test";

// Skip all tests if GitHub App credentials are not set
const SKIP_TESTS =
  !process.env.XFG_GITHUB_APP_ID || !process.env.XFG_GITHUB_APP_PRIVATE_KEY;

if (SKIP_TESTS) {
  console.log(
    "\n⚠️  Skipping GitHub App integration tests: XFG_GITHUB_APP_ID and XFG_GITHUB_APP_PRIVATE_KEY not set\n"
  );
}

// This exec helper is only used in integration tests with hardcoded commands.
// The commands are controlled and not derived from external/user input.
function exec(command: string, options?: { cwd?: string }): string {
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

describe("GitHub App Integration Test", { skip: SKIP_TESTS }, () => {
  before(() => {
    console.log("\n=== Setting up GitHub App integration test ===\n");

    // 1. Close any existing PRs from the sync branch
    console.log("Closing any existing PRs...");
    try {
      const existingPRs = exec(
        `gh pr list --repo ${TEST_REPO} --head ${BRANCH_NAME} --json number --jq '.[].number'`
      );
      if (existingPRs) {
        for (const prNumber of existingPRs.split("\n").filter(Boolean)) {
          console.log(`  Closing PR #${prNumber}`);
          exec(`gh pr close ${prNumber} --repo ${TEST_REPO} --delete-branch`);
        }
      } else {
        console.log("  No existing PRs found");
      }
    } catch {
      console.log("  No existing PRs to close");
    }

    // 2. Delete the target file if it exists in the default branch
    console.log(`Checking if ${TARGET_FILE} exists in repo...`);
    try {
      const fileExists = exec(
        `gh api repos/${TEST_REPO}/contents/${TARGET_FILE} --jq '.sha' 2>/dev/null || echo ""`
      );
      if (fileExists) {
        console.log(`  Deleting ${TARGET_FILE} from repo...`);
        exec(
          `gh api --method DELETE repos/${TEST_REPO}/contents/${TARGET_FILE} -f message="test: remove ${TARGET_FILE} for integration test" -f sha="${fileExists}"`
        );
        console.log("  File deleted");
      } else {
        console.log("  File does not exist");
      }
    } catch {
      console.log("  File does not exist or already deleted");
    }

    // 3. Delete the remote branch if it exists
    console.log(`Deleting remote branch ${BRANCH_NAME} if exists...`);
    try {
      exec(
        `gh api --method DELETE repos/${TEST_REPO}/git/refs/heads/${BRANCH_NAME}`
      );
      console.log("  Branch deleted");
    } catch {
      console.log("  Branch does not exist");
    }

    // 4. Clean up local tmp directory
    const tmpDir = join(projectRoot, "tmp");
    if (existsSync(tmpDir)) {
      console.log("Cleaning up tmp directory...");
      rmSync(tmpDir, { recursive: true, force: true });
    }

    console.log("\n=== Setup complete ===\n");
  });

  test("creates verified commit via GraphQL API with GitHub App credentials", async () => {
    const configPath = join(fixturesDir, "integration-test-github-app.yaml");

    // Run the sync tool with GitHub App credentials
    console.log("Running xfg with GitHub App credentials...");
    const output = exec(`node dist/cli.js --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // Verify PR was created
    console.log("\nVerifying PR was created...");
    const prList = exec(
      `gh pr list --repo ${TEST_REPO} --head ${BRANCH_NAME} --json number,title,url --jq '.[0]'`
    );

    assert.ok(prList, "Expected a PR to be created");

    const pr = JSON.parse(prList);
    console.log(`  PR #${pr.number}: ${pr.title}`);
    console.log(`  URL: ${pr.url}`);

    assert.ok(pr.number, "PR should have a number");

    // Get the commit SHA from the PR branch
    console.log("\nGetting commit info from PR branch...");
    const commitSha = exec(
      `gh api repos/${TEST_REPO}/commits/${BRANCH_NAME} --jq '.sha'`
    );
    console.log(`  Commit SHA: ${commitSha}`);

    // Verify the commit is verified (signed by GitHub App)
    console.log("\nVerifying commit is verified...");
    const commitVerification = exec(
      `gh api repos/${TEST_REPO}/commits/${commitSha} --jq '.commit.verification'`
    );
    const verification = JSON.parse(commitVerification);
    console.log(`  Verification status:`, verification);

    assert.equal(
      verification.verified,
      true,
      "Commit should be verified (signed by GitHub)"
    );

    // Check the verification reason
    console.log(`  Verification reason: ${verification.reason}`);

    // Verify commit author is the GitHub App, NOT github-actions[bot]
    // This catches the bug where PAT URL rewrite leaks into clone and wrong credential is used
    console.log("\nVerifying commit author is GitHub App...");
    const commitAuthor = exec(
      `gh api repos/${TEST_REPO}/commits/${commitSha} --jq '.commit.author.name'`
    );
    console.log(`  Commit author: ${commitAuthor}`);

    assert.notEqual(
      commitAuthor,
      "github-actions[bot]",
      "Commit author should be GitHub App, not github-actions[bot]. " +
        "This indicates the PAT URL rewrite leaked into the clone URL."
    );

    // Verify the file exists in the PR branch
    console.log("\nVerifying file exists in PR branch...");
    const fileContent = exec(
      `gh api repos/${TEST_REPO}/contents/${TARGET_FILE}?ref=${BRANCH_NAME} --jq '.content' | base64 -d`
    );

    assert.ok(fileContent, "File should exist in PR branch");

    const json = JSON.parse(fileContent);
    console.log("  File content:", JSON.stringify(json, null, 2));

    assert.equal(
      json.githubAppTest,
      true,
      "File should have githubAppTest: true"
    );

    console.log("\n=== GitHub App integration test passed ===\n");
  });

  test("direct mode with GitHub App creates verified commit on main", async () => {
    const directFile = "github-app-direct-test.json";

    console.log("\n=== Testing direct mode with GitHub App ===\n");

    // 1. Delete the direct test file if it exists
    console.log(`Deleting ${directFile} if exists...`);
    try {
      const sha = exec(
        `gh api repos/${TEST_REPO}/contents/${directFile} --jq '.sha'`
      );
      if (sha && !sha.includes("Not Found")) {
        exec(
          `gh api --method DELETE repos/${TEST_REPO}/contents/${directFile} -f message="test: cleanup ${directFile}" -f sha="${sha}"`
        );
        console.log("  File deleted");
      }
    } catch {
      console.log("  File does not exist");
    }

    // 2. Run sync with direct mode config
    console.log("\nRunning xfg with direct mode + GitHub App...");
    const configPath = join(
      fixturesDir,
      "integration-test-github-app-direct.yaml"
    );
    const output = exec(`node dist/cli.js --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // 3. Verify NO PR was created (direct mode)
    console.log("\nVerifying no PR was created...");
    try {
      const prList = exec(
        `gh pr list --repo ${TEST_REPO} --head chore/sync-github-app-direct --json number --jq '.[0].number'`
      );
      assert.ok(!prList, "No PR should be created in direct mode");
    } catch {
      console.log("  No PR found - correct for direct mode");
    }

    // 4. Verify the file exists on main
    console.log("\nVerifying file exists on main branch...");
    const fileContent = exec(
      `gh api repos/${TEST_REPO}/contents/${directFile} --jq '.content' | base64 -d`
    );

    assert.ok(fileContent, "File should exist on main branch");
    const json = JSON.parse(fileContent);
    console.log("  File content:", JSON.stringify(json, null, 2));
    assert.equal(json.directMode, true, "File should have directMode: true");

    // 5. Get the most recent commit on main and verify it's verified
    console.log("\nVerifying commit on main is verified...");
    const mainCommitSha = exec(
      `gh api repos/${TEST_REPO}/commits/main --jq '.sha'`
    );
    const mainCommitVerification = exec(
      `gh api repos/${TEST_REPO}/commits/${mainCommitSha} --jq '.commit.verification'`
    );
    const verification = JSON.parse(mainCommitVerification);
    console.log(`  Verification status:`, verification);

    assert.equal(
      verification.verified,
      true,
      "Direct mode commit should be verified"
    );

    // Verify commit author is GitHub App, not github-actions[bot]
    console.log("\nVerifying commit author is GitHub App...");
    const commitAuthor = exec(
      `gh api repos/${TEST_REPO}/commits/${mainCommitSha} --jq '.commit.author.name'`
    );
    console.log(`  Commit author: ${commitAuthor}`);

    assert.notEqual(
      commitAuthor,
      "github-actions[bot]",
      "Direct mode commit author should be GitHub App, not github-actions[bot]"
    );

    // 6. Cleanup
    console.log("\nCleaning up...");
    try {
      const sha = exec(
        `gh api repos/${TEST_REPO}/contents/${directFile} --jq '.sha'`
      );
      exec(
        `gh api --method DELETE repos/${TEST_REPO}/contents/${directFile} -f message="test: cleanup ${directFile}" -f sha="${sha}"`
      );
      console.log("  File deleted");
    } catch {
      console.log("  Could not delete file");
    }

    console.log("\n=== Direct mode with GitHub App test passed ===\n");
  });

  test("deleteOrphaned removes files via GraphQL API with verified commit", async () => {
    const orphanFile = "github-app-orphan-test.json";
    const remainingFile = "github-app-remaining.json";
    const manifestFile = ".xfg.json";
    const configId = "integration-test-github-app-delete";

    console.log("\n=== Testing deleteOrphaned with GitHub App ===\n");

    // 1. Cleanup: Close PRs and delete files
    console.log("Cleaning up before test...");
    for (const file of [orphanFile, manifestFile, remainingFile]) {
      try {
        const sha = exec(
          `gh api repos/${TEST_REPO}/contents/${file} --jq '.sha'`
        );
        if (sha && !sha.includes("Not Found")) {
          exec(
            `gh api --method DELETE repos/${TEST_REPO}/contents/${file} -f message="test: cleanup ${file}" -f sha="${sha}"`
          );
          console.log(`  Deleted ${file}`);
        }
      } catch {
        console.log(`  ${file} does not exist`);
      }
    }

    // 2. Phase 1: Create files with deleteOrphaned config
    console.log("\n--- Phase 1: Create files with deleteOrphaned: true ---\n");
    const configPath1 = join(
      fixturesDir,
      "integration-test-github-app-delete-phase1.yaml"
    );
    const output1 = exec(`node dist/cli.js --config ${configPath1}`, {
      cwd: projectRoot,
    });
    console.log(output1);

    // 3. Verify files exist on main
    console.log("\nVerifying files exist on main...");
    const orphanContent = exec(
      `gh api repos/${TEST_REPO}/contents/${orphanFile} --jq '.content' | base64 -d`
    );
    assert.ok(orphanContent, "Orphan file should exist");
    console.log(`  ${orphanFile} exists`);

    const manifestContent = exec(
      `gh api repos/${TEST_REPO}/contents/${manifestFile} --jq '.content' | base64 -d`
    );
    const manifest = JSON.parse(manifestContent);
    // v3 manifest format uses { files: [...], rulesets: [...] }
    assert.ok(
      manifest.configs[configId]?.files?.includes(orphanFile),
      "Manifest should track orphan file"
    );
    console.log("  Manifest tracks orphan file");

    // 4. Phase 2: Remove the file from config (should trigger deletion)
    console.log("\n--- Phase 2: Remove file from config (should delete) ---\n");
    const configPath2 = join(
      fixturesDir,
      "integration-test-github-app-delete-phase2.yaml"
    );
    const output2 = exec(`node dist/cli.js --config ${configPath2}`, {
      cwd: projectRoot,
    });
    console.log(output2);

    // 5. Verify file was deleted
    console.log("\nVerifying orphan file was deleted...");
    try {
      exec(`gh api repos/${TEST_REPO}/contents/${orphanFile} --jq '.sha'`);
      assert.fail("Orphan file should have been deleted");
    } catch {
      console.log(`  ${orphanFile} correctly deleted`);
    }

    // 6. Verify the deletion commit is verified
    console.log("\nVerifying deletion commit is verified...");
    const mainCommitSha = exec(
      `gh api repos/${TEST_REPO}/commits/main --jq '.sha'`
    );
    const verification = JSON.parse(
      exec(
        `gh api repos/${TEST_REPO}/commits/${mainCommitSha} --jq '.commit.verification'`
      )
    );
    console.log(`  Verification status:`, verification);
    assert.equal(
      verification.verified,
      true,
      "Deletion commit should be verified"
    );

    // Verify commit author is GitHub App, not github-actions[bot]
    console.log("\nVerifying commit author is GitHub App...");
    const commitAuthor = exec(
      `gh api repos/${TEST_REPO}/commits/${mainCommitSha} --jq '.commit.author.name'`
    );
    console.log(`  Commit author: ${commitAuthor}`);

    assert.notEqual(
      commitAuthor,
      "github-actions[bot]",
      "Deletion commit author should be GitHub App, not github-actions[bot]"
    );

    // 7. Cleanup
    console.log("\nCleaning up...");
    for (const file of [manifestFile, remainingFile]) {
      try {
        const sha = exec(
          `gh api repos/${TEST_REPO}/contents/${file} --jq '.sha'`
        );
        if (sha && !sha.includes("Not Found")) {
          exec(
            `gh api --method DELETE repos/${TEST_REPO}/contents/${file} -f message="test: cleanup ${file}" -f sha="${sha}"`
          );
          console.log(`  Deleted ${file}`);
        }
      } catch {
        console.log(`  Could not delete ${file}`);
      }
    }

    console.log("\n=== deleteOrphaned with GitHub App test passed ===\n");
  });
});
