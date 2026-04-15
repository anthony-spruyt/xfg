# Rename `appId` → `clientId` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename all xfg-owned `appId` / `XFG_GITHUB_APP_ID` / `github-app-id` names to `clientId` / `XFG_GITHUB_CLIENT_ID` / `github-client-id` (breaking, v6.0.0). Closes #700.

**Architecture:** Pure rename with no behavior change. External surface (action input + env var) renames without backwards-compatible alias. Internal TypeScript identifiers (`appId` param/field, `TEST_APP_ID` fixture, test variables) renamed end-to-end. Octokit's `createAppAuth({ appId })` parameter name is third-party and not touched; it already accepts Client IDs.

**Tech Stack:** TypeScript, Node.js, GitHub Actions (composite action), Vitest unit tests, integration tests against real platforms.

**Spec:** `plans/superpowers/specs/2026-04-15-rename-app-id-to-client-id-design.md`

---

## Task 0: Verify branch

Branch `chore/rename-app-id-to-client-id` was created when the spec was committed. Confirm you are on it before any other task.

- [ ] **Step 1: Confirm branch**

Run: `git rev-parse --abbrev-ref HEAD`
Expected output: `chore/rename-app-id-to-client-id`

If not on that branch, run `git checkout chore/rename-app-id-to-client-id`. If it does not exist locally, run `git checkout -b chore/rename-app-id-to-client-id` from `main`.

---

## File Map

**Production code (modify):**
- `action.yml` — input key + env var passthrough
- `src/vcs/github-app-token-manager.ts` — constructor param, private field, JWT iss
- `src/vcs/commit-strategy-selector.ts` — `AppCredentials.appId` type field + usage
- `src/cli/sync-command.ts` — `process.env.XFG_GITHUB_APP_ID` reads + factory options key

**Verified re-export only (no edit):**
- `src/vcs/index.ts` — re-exports from `commit-strategy-selector.ts`; no direct `appId` reference.

**Tests (modify):**
- `test/fixtures/test-fixtures.ts` — `TEST_APP_ID` export
- `test/unit/github-app-token-manager.test.ts` — all references (21 call sites + `creates instance with appId` test name + `JWT payload has correct issuer (appId)` test name)
- `test/unit/vcs/commit-strategy-selector.test.ts` — fixture key
- `test/unit/repository-processor.test.ts` — `process.env.XFG_GITHUB_APP_ID` (many sites), `originalAppId` locals, `TEST_APP_ID` import/usage, `appId: "12345"` fixture
- `test/integration/github-app.test.ts` — env var checks + skip message + unset block
- `test/integration/github-lifecycle-app.test.ts` — env var checks + skip message

**Docs (modify):**
- `docs/platforms/github-app.md`
- `docs/ci-cd/github-actions.md`
- `README.md` — grep first (likely mentions input name)

**Workflow (modify):**
- `.github/workflows/_integration-tests.yaml` — 2 × `XFG_GITHUB_APP_ID` env keys (lines 107, 391). (Lines 260 and 490 already use `github-app-id` input → update to `github-client-id`.)

**Out of scope:**
- `plans/2026-03-29-file-mode-fixup-commit-plan.md` — historical plan; do not edit
- `.desloppify/**` — scanner state; will re-scan after merge
- `docs/superpowers/**` and `plans/superpowers/**` spec/plan references — historical

---

## Task 1: Rename external surface (`action.yml`)

**Files:**
- Modify: `action.yml`

- [ ] **Step 1: Update input key and env passthrough**

Replace the input definition around line 48:

```yaml
  github-client-id:
    description: "GitHub App Client ID (generates installation tokens automatically)"
    required: false
```

And the env passthrough around line 129:

```yaml
        XFG_GITHUB_CLIENT_ID: ${{ inputs.github-client-id }}
```

- [ ] **Step 2: Verify no other references**

Run: `grep -n "github-app-id\|XFG_GITHUB_APP_ID" action.yml`
Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add action.yml
git commit -m "feat(action)!: rename github-app-id input to github-client-id"
```

---

## Task 2: Rename `GitHubAppTokenManager` internals

**Files:**
- Modify: `src/vcs/github-app-token-manager.ts:38-71`

- [ ] **Step 1: Rename field, constructor param, and JWT iss claim**

In `src/vcs/github-app-token-manager.ts`, replace lines 37–71 so the class opens like this:

```ts
export class GitHubAppTokenManager {
  private readonly clientId: string;
  private readonly privateKey: string;

  /** Map of "apiHost:owner" -> installation ID */
  private installations = new Map<string, number>();

  /** Set of API hosts that have been discovered */
  private discoveredHosts = new Set<string>();

  /** Map of "apiHost:owner" -> cached token */
  private tokenCache = new Map<string, CachedToken>();

  constructor(clientId: string, privateKey: string) {
    this.clientId = clientId;
    this.privateKey = privateKey;
  }

  /**
   * Generates a JWT for GitHub App authentication.
   * The JWT is signed with RS256 and valid for 10 minutes.
   */
  generateJWT(): string {
    const now = Math.floor(Date.now() / 1000);

    const header = {
      alg: "RS256",
      typ: "JWT",
    };

    const payload = {
      iat: now - 60, // Issued 60 seconds ago to account for clock drift
      exp: now + 600, // Expires in 10 minutes
      iss: this.clientId,
    };
```

(Rest of file unchanged.)

- [ ] **Step 2: Verify no stray `appId` left in the file**

Run: `grep -n "appId" src/vcs/github-app-token-manager.ts`
Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add src/vcs/github-app-token-manager.ts
git commit -m "refactor(vcs)!: rename GitHubAppTokenManager appId to clientId"
```

---

## Task 3: Rename `GitHubAppCredentials` in `commit-strategy-selector.ts`

**Files:**
- Modify: `src/vcs/commit-strategy-selector.ts:10-23`

- [ ] **Step 1: Rename the type field and the constructor argument**

In `src/vcs/commit-strategy-selector.ts` (in the `GitHubAppCredentials` interface and the `createTokenManager` function), change line 10 from `appId: string;` to `clientId: string;`, and change line 23 from `new GitHubAppTokenManager(credentials.appId, credentials.privateKey)` to `new GitHubAppTokenManager(credentials.clientId, credentials.privateKey)`.

- [ ] **Step 2: Verify**

Run: `grep -n "appId\|APP_ID" src/vcs/commit-strategy-selector.ts`
Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add src/vcs/commit-strategy-selector.ts
git commit -m "refactor(vcs)!: rename AppCredentials.appId to clientId"
```

---

## Task 4: Rename env var reads and factory key in `sync-command.ts`

**Files:**
- Modify: `src/cli/sync-command.ts:690-697`

- [ ] **Step 1: Replace the token-manager construction block**

Replace lines 690–697 with:

```ts
  const tokenManager = createTokenManager(
    process.env.XFG_GITHUB_CLIENT_ID && process.env.XFG_GITHUB_APP_PRIVATE_KEY
      ? {
          clientId: process.env.XFG_GITHUB_CLIENT_ID,
          privateKey: process.env.XFG_GITHUB_APP_PRIVATE_KEY,
        }
      : undefined
  );
```

Note: `XFG_GITHUB_APP_PRIVATE_KEY` is intentionally unchanged — only the ID name is in scope for this rename.

- [ ] **Step 2: Verify**

Run: `grep -n "XFG_GITHUB_APP_ID\|appId" src/cli/sync-command.ts`
Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add src/cli/sync-command.ts
git commit -m "refactor(cli)!: read XFG_GITHUB_CLIENT_ID instead of XFG_GITHUB_APP_ID"
```

---

## Task 5: Verify build + check red state

- [ ] **Step 1: TypeScript build (production only — should PASS)**

Run: `npm run build`
Expected: PASS. `tsconfig.json` excludes tests, so `tsc` compiles only `src/**` which is now internally consistent after Tasks 1–4.

If this FAILS, a production-code change is broken — fix before proceeding.

- [ ] **Step 2: Test typecheck (should FAIL — this is the red state)**

Run: `npm run test:typecheck`
Expected: FAIL with type errors in `test/unit/github-app-token-manager.test.ts`, `test/unit/vcs/commit-strategy-selector.test.ts`, `test/unit/repository-processor.test.ts`, and both `test/integration/github*.ts` files — they reference the old `TEST_APP_ID` / `appId` / `XFG_GITHUB_APP_ID` names.

- [ ] **Step 3: Run unit tests (should FAIL)**

Run: `npm test`
Expected: FAIL in the same test files. This is the red state — proceed to Task 6.

---

## Task 6: Rename test fixtures

**Files:**
- Modify: `test/fixtures/test-fixtures.ts:37`

- [ ] **Step 1: Rename the export**

Change line 37 from:

```ts
export const TEST_APP_ID = "12345";
```

to:

```ts
export const TEST_CLIENT_ID = "12345";
```

- [ ] **Step 2: Commit (tests will still be broken — fixed in next tasks)**

```bash
git add test/fixtures/test-fixtures.ts
git commit -m "test: rename TEST_APP_ID fixture to TEST_CLIENT_ID"
```

---

## Task 7: Fix `github-app-token-manager.test.ts`

**Files:**
- Modify: `test/unit/github-app-token-manager.test.ts`

- [ ] **Step 1: Update import, references, and test names**

- Change the import on line 4: `TEST_APP_ID` → `TEST_CLIENT_ID`.
- Replace ALL occurrences of `TEST_APP_ID` in the file with `TEST_CLIENT_ID` (21 call sites + the string passed to `GitHubAppTokenManager`).
- Rename test on line 41 from `"creates instance with appId and privateKey"` to `"creates instance with clientId and privateKey"`.
- Rename test on line 74 from `"JWT payload has correct issuer (appId)"` to `"JWT payload has correct issuer (clientId)"`.

Use your editor's replace-in-file: `TEST_APP_ID` → `TEST_CLIENT_ID` (whole-word).

- [ ] **Step 2: Run this test file to verify green**

Run: `npx vitest run test/unit/github-app-token-manager.test.ts`
Expected: PASS (all tests).

- [ ] **Step 3: Commit**

```bash
git add test/unit/github-app-token-manager.test.ts
git commit -m "test: update GitHubAppTokenManager tests for clientId rename"
```

---

## Task 8: Fix `commit-strategy-selector.test.ts`

**Files:**
- Modify: `test/unit/vcs/commit-strategy-selector.test.ts:26`

- [ ] **Step 1: Update fixture key**

Change line 26 from `appId: "12345",` to `clientId: "12345",`.

- [ ] **Step 2: Run**

Run: `npx vitest run test/unit/vcs/commit-strategy-selector.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add test/unit/vcs/commit-strategy-selector.test.ts
git commit -m "test: update commit-strategy-selector fixture for clientId rename"
```

---

## Task 9: Fix `repository-processor.test.ts`

**Files:**
- Modify: `test/unit/repository-processor.test.ts`

This file has many sites. Do them in a single sweep, then verify.

- [ ] **Step 1: Global rename within this file**

Perform the following in-file replacements (all whole-word):

- `XFG_GITHUB_APP_ID` → `XFG_GITHUB_CLIENT_ID` (all env var references; covers lines 1749, 1754, 1858, 1860, 1872, 1877, 1938, 1940, 1951, 1955, 2010, 2012, 2023, 2027, 2082, 2084, 2095, 2099, 2153, 2155, 2295, 2298, 2304, 2306, 2318, 2320, 2459).
- `originalAppId` → `originalClientId` (local variables at lines 1749, 1872, 1951, 2023, 2095, 2291, 2295, etc.).
- `TEST_APP_ID` → `TEST_CLIENT_ID` (imports at 2389 and 2455, usage at 2414 and 2459).
- On line 2320, the assertion message `"XFG_GITHUB_APP_ID should not be set"` → `"XFG_GITHUB_CLIENT_ID should not be set"`.
- On line 2378, the inline fixture key `appId: "12345",` → `clientId: "12345",`.

- [ ] **Step 2: Verify no stragglers**

Run: `grep -n "XFG_GITHUB_APP_ID\|TEST_APP_ID\|originalAppId\|appId:" test/unit/repository-processor.test.ts`
Expected: no matches.

- [ ] **Step 3: Run the test file**

Run: `npx vitest run test/unit/repository-processor.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add test/unit/repository-processor.test.ts
git commit -m "test: update repository-processor tests for clientId rename"
```

---

## Task 10: Fix integration tests

**Files:**
- Modify: `test/integration/github-app.test.ts:21, 25, 287`
- Modify: `test/integration/github-lifecycle-app.test.ts:25, 29`

- [ ] **Step 1: Rename env var references and skip messages in both files**

In both files, replace:

- `process.env.XFG_GITHUB_APP_ID` → `process.env.XFG_GITHUB_CLIENT_ID`
- Skip message `"XFG_GITHUB_APP_ID and XFG_GITHUB_APP_PRIVATE_KEY not set"` → `"XFG_GITHUB_CLIENT_ID and XFG_GITHUB_APP_PRIVATE_KEY not set"`

In `test/integration/github-app.test.ts` line 287 (an env override object):

```ts
    XFG_GITHUB_CLIENT_ID: undefined,
```

- [ ] **Step 2: Verify**

Run: `grep -rn "XFG_GITHUB_APP_ID" test/integration/`
Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add test/integration/github-app.test.ts test/integration/github-lifecycle-app.test.ts
git commit -m "test(integration): rename XFG_GITHUB_APP_ID to XFG_GITHUB_CLIENT_ID"
```

---

## Task 11: Full unit test + typecheck run

- [ ] **Step 1: Run unit tests**

Run: `npm test`
Expected: PASS (entire suite).

- [ ] **Step 2: Run test typecheck**

Run: `npm run test:typecheck`
Expected: PASS (no type errors).

- [ ] **Step 3: Lint**

Run: `./lint.sh`
Expected: PASS.

If any step fails, fix before proceeding. Do NOT skip this task.

---

## Task 12: Update integration workflow

**Files:**
- Modify: `.github/workflows/_integration-tests.yaml:107, 260, 391, 490`

- [ ] **Step 1: Rename the 4 references**

- Line 107: `XFG_GITHUB_APP_ID: ${{ vars.TEST_CLIENT_ID }}` → `XFG_GITHUB_CLIENT_ID: ${{ vars.TEST_CLIENT_ID }}`
- Line 260: `github-app-id: ${{ vars.TEST_CLIENT_ID }}` → `github-client-id: ${{ vars.TEST_CLIENT_ID }}`
- Line 391: `XFG_GITHUB_APP_ID: ${{ vars.TEST_CLIENT_ID }}` → `XFG_GITHUB_CLIENT_ID: ${{ vars.TEST_CLIENT_ID }}`
- Line 490: `github-app-id: ${{ vars.TEST_CLIENT_ID }}` → `github-client-id: ${{ vars.TEST_CLIENT_ID }}`

- [ ] **Step 2: Verify**

Run: `grep -n "github-app-id\|XFG_GITHUB_APP_ID" .github/workflows/_integration-tests.yaml`
Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/_integration-tests.yaml
git commit -m "ci!: rename github-app-id to github-client-id in integration workflow"
```

---

## Task 13: Update docs

**Files:**
- Modify: `docs/platforms/github-app.md`
- Modify: `docs/ci-cd/github-actions.md`
- Modify: `README.md` (if it references either name — check first)

- [ ] **Step 1: Update `docs/platforms/github-app.md`**

- Line 39: `- **Variables:** \`APP_ID\` (the numeric app ID)` → `- **Variables:** \`CLIENT_ID\` (the GitHub App Client ID, starts with \`Iv23\`)`
- Line 54: `github-app-id: ${{ vars.APP_ID }}` → `github-client-id: ${{ vars.CLIENT_ID }}`
- Line 84: in the env var table, `XFG_GITHUB_APP_ID` → `XFG_GITHUB_CLIENT_ID` and description `App ID for installation token generation` → `GitHub App Client ID for installation token generation`
- Line 88: `When \`XFG_GITHUB_APP_ID\` and \`XFG_GITHUB_APP_PRIVATE_KEY\` are set` → `When \`XFG_GITHUB_CLIENT_ID\` and \`XFG_GITHUB_APP_PRIVATE_KEY\` are set`
- Line 114: `(\`github-app-id\` and \`github-app-private-key\` inputs)` → `(\`github-client-id\` and \`github-app-private-key\` inputs)`

- [ ] **Step 2: Update `docs/ci-cd/github-actions.md`**

- Line 29: input name cell `` `github-app-id` `` → `` `github-client-id` ``. Description `GitHub App ID for installation token generation` → `GitHub App Client ID for installation token generation`.
- Line 102: `github-app-id: ${{ vars.APP_ID }}` → `github-client-id: ${{ vars.CLIENT_ID }}`

- [ ] **Step 3: Check and update `README.md` if needed**

Run: `grep -n "github-app-id\|XFG_GITHUB_APP_ID\|APP_ID" README.md`
For each match: if it's a reference to the xfg input/env var/repo var, update to the new name. If it's talking about something else (unlikely), leave it.

- [ ] **Step 4: Final grep across the whole repo (excluding historical plans and scanner state)**

Run:

```bash
grep -rn -E "XFG_GITHUB_APP_ID|github-app-id|TEST_APP_ID|originalAppId|\bappId\b|\bAPP_ID\b" \
  --exclude-dir=node_modules \
  --exclude-dir=.desloppify \
  --exclude-dir=plans \
  --exclude-dir=docs/superpowers \
  --exclude-dir=dist \
  --exclude-dir=.git \
  .
```

Expected: no matches. (Note: `appId` may still appear as a word inside a comment referring to Octokit's `createAppAuth({ appId })` third-party parameter if such a comment exists — if so, that is acceptable and the only allowed match. Otherwise no matches.)

- [ ] **Step 5: Commit**

```bash
git add docs/platforms/github-app.md docs/ci-cd/github-actions.md README.md
git commit -m "docs!: rename github-app-id to github-client-id"
```

(Omit `README.md` from the `git add` if it had no matches.)

---

## Task 14: Full pre-PR verification

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 2: Unit tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Test typecheck**

Run: `npm run test:typecheck`
Expected: PASS.

- [ ] **Step 4: Lint**

Run: `./lint.sh`
Expected: PASS.

- [ ] **Step 5: Integration tests (all three platforms)**

Run, in order:

```bash
npm run test:integration:github
npm run test:integration:ado
npm run test:integration:gitlab
```

Expected: PASS (or the usual platform-gated skip for envs missing the required secrets — for the GitHub app suite, with the renamed `XFG_GITHUB_CLIENT_ID`, tests should actually run).

If any of these fail, STOP — do not open the PR. Debug and fix first.

---

## Task 15: Open PR

- [ ] **Step 1: Push**

Run:

```bash
git push -u origin chore/rename-app-id-to-client-id
```

- [ ] **Step 2: Create PR**

Run:

````bash
gh pr create --title "feat!: rename github-app-id to github-client-id (v6.0.0)" --body "$(cat <<'EOF'
Closes #700

## Summary
- Rename action input `github-app-id` → `github-client-id`
- Rename env var `XFG_GITHUB_APP_ID` → `XFG_GITHUB_CLIENT_ID`
- Rename all xfg-owned internal identifiers (`appId` → `clientId`) across `src/` and `test/`
- Update docs and integration workflow
- Breaking change — ships as v6.0.0

## Migration
```text
action.yml input: github-app-id → github-client-id
env var:          XFG_GITHUB_APP_ID → XFG_GITHUB_CLIENT_ID
```

Octokit's `createAppAuth({ appId })` parameter name is third-party and unchanged; it already accepts Client IDs.

## Test plan
- [x] npm test
- [x] npm run test:typecheck
- [x] ./lint.sh
- [x] npm run test:integration:github
- [x] npm run test:integration:ado
- [x] npm run test:integration:gitlab

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
````

- [ ] **Step 3: Enable automerge**

Run:

```bash
gh pr merge --auto --squash --delete-branch
```

- [ ] **Step 4: Wait for CI to pass, then confirm merge**

Watch CI via `gh pr checks --watch`. After merge, checkout main, pull, and confirm main CI is green before recommending a release.

- [ ] **Step 5: Release (only after user confirms)**

After PR merged and main is green, tell the user to run:

```bash
gh workflow run release.yaml -f version=major
```

This ships v6.0.0.
