import { test, describe, before } from 'node:test';
import { strict as assert } from 'node:assert';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');
const fixturesDir = join(projectRoot, 'fixtures');

const TEST_REPO = 'anthony-spruyt/json-config-sync-test';
const TARGET_FILE = 'my.config.json';
const BRANCH_NAME = 'chore/sync-my-config';

function exec(command: string, options?: { cwd?: string }): string {
  try {
    return execSync(command, {
      cwd: options?.cwd ?? projectRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const err = error as { stderr?: string; stdout?: string };
    console.error('Command failed:', command);
    console.error('stderr:', err.stderr);
    console.error('stdout:', err.stdout);
    throw error;
  }
}

describe('Integration Test', () => {
  before(() => {
    console.log('\n=== Setting up integration test ===\n');

    // 0. Initialize repo if empty (create initial commit)
    console.log('Checking if repo is initialized...');
    try {
      exec(`gh api repos/${TEST_REPO}/commits --jq '.[0].sha'`);
      console.log('  Repo has commits');
    } catch {
      console.log('  Repo is empty, initializing with README...');
      exec(
        `gh api --method PUT repos/${TEST_REPO}/contents/README.md -f message="Initial commit" -f content="$(echo '# Test Repository\n\nThis repo is used for integration testing json-config-sync.' | base64 -w0)"`
      );
      console.log('  Repo initialized');
    }

    // 1. Close any existing PRs from the sync branch
    console.log('Closing any existing PRs...');
    try {
      const existingPRs = exec(
        `gh pr list --repo ${TEST_REPO} --head ${BRANCH_NAME} --json number --jq '.[].number'`
      );
      if (existingPRs) {
        for (const prNumber of existingPRs.split('\n').filter(Boolean)) {
          console.log(`  Closing PR #${prNumber}`);
          exec(`gh pr close ${prNumber} --repo ${TEST_REPO} --delete-branch`);
        }
      } else {
        console.log('  No existing PRs found');
      }
    } catch {
      console.log('  No existing PRs to close');
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
        console.log('  File deleted');
      } else {
        console.log('  File does not exist');
      }
    } catch {
      console.log('  File does not exist or already deleted');
    }

    // 3. Delete the remote branch if it exists
    console.log(`Deleting remote branch ${BRANCH_NAME} if exists...`);
    try {
      exec(`gh api --method DELETE repos/${TEST_REPO}/git/refs/heads/${BRANCH_NAME}`);
      console.log('  Branch deleted');
    } catch {
      console.log('  Branch does not exist');
    }

    // 4. Clean up local tmp directory
    const tmpDir = join(projectRoot, 'tmp');
    if (existsSync(tmpDir)) {
      console.log('Cleaning up tmp directory...');
      rmSync(tmpDir, { recursive: true, force: true });
    }

    console.log('\n=== Setup complete ===\n');
  });

  test('sync creates a PR in the test repository', async () => {
    const configPath = join(fixturesDir, 'integration-test-config.yaml');

    // Run the sync tool
    console.log('Running json-config-sync...');
    const output = exec(
      `node dist/index.js --config ${configPath}`,
      { cwd: projectRoot }
    );
    console.log(output);

    // Verify PR was created
    console.log('\nVerifying PR was created...');
    const prList = exec(
      `gh pr list --repo ${TEST_REPO} --head ${BRANCH_NAME} --json number,title,url --jq '.[0]'`
    );

    assert.ok(prList, 'Expected a PR to be created');

    const pr = JSON.parse(prList);
    console.log(`  PR #${pr.number}: ${pr.title}`);
    console.log(`  URL: ${pr.url}`);

    assert.ok(pr.number, 'PR should have a number');
    assert.ok(pr.title.includes('sync'), 'PR title should mention sync');

    // Verify the file exists in the PR branch
    console.log('\nVerifying file exists in PR branch...');
    const fileContent = exec(
      `gh api repos/${TEST_REPO}/contents/${TARGET_FILE}?ref=${BRANCH_NAME} --jq '.content' | base64 -d`
    );

    assert.ok(fileContent, 'File should exist in PR branch');
    assert.ok(fileContent.includes('prop1'), 'File should contain expected content');

    console.log('  File content verified');
    console.log('\n=== Integration test passed ===\n');
  });
});
