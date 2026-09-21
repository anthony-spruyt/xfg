# Scope secrets by group and repo

## Context

Today `secrets:` sits at the **root** of the config only (`packages/xfg/src/config/types.ts:520`), and `xfg secrets sync` pushes the same secret list to **every** repo in `config.repos` (`packages/xfg/src/cli/secrets-command.ts:102-115`). There is no way to say "this secret only goes to the frontend repos". The docs state the limitation outright (`docs/configuration/secrets.md:3`).

There is no technical reason for this. `variables:` — the closest sibling, added in the same PR (#772) — lives under `settings:` and already gets the full root → group → conditional-group → repo merge with `inherit` support. Secrets got a flat root-level shape and their own command instead, most likely because the env-var resolution and libsodium encryption made a separate command the quick path.

**Goal:** move `secrets:` under `settings:` so it inherits the existing merge pipeline for free, while keeping `xfg secrets sync` as a separate command so secrets are never touched by a plain `xfg sync`.

Breaking change, no back-compat shim — confirmed with the user.

### Before / after

```yaml
# before
secrets:
  MY_KEY: { env: MY_KEY_VALUE }

# after — root, plus group and per-repo scoping
settings:
  secrets:
    MY_KEY: { env: MY_KEY_VALUE }

groups:
  frontend:
    settings:
      secrets:
        NPM_TOKEN: { env: NPM_TOKEN_VALUE }

repos:
  - git: git@github.com:org/web.git
    groups: [frontend]
    settings:
      secrets:
        inherit: false            # skip all inherited secrets
        DEPLOY_KEY: { env: WEB_DEPLOY_KEY }
  - git: git@github.com:org/api.git
    settings:
      secrets:
        MY_KEY: false             # opt out of one inherited secret
```

### Key insight: config location and execution are independent

`xfg sync` only runs the settings listed in `buildSettingsDescriptors` (`packages/xfg/src/cli/settings-runner.ts:73-154`). By **not** adding a `secrets` descriptor there, `xfg sync` walks straight past secrets even though they now live under `settings:`. `xfg secrets sync` reads `repoConfig.settings.secrets` per repo instead of the flat `config.secrets`.

### Note on `chore/desloppify`

That unmerged branch already did the `src/secrets/` → `src/settings/secrets/` move, added `diffSecrets`, and aligned `SecretsProcessor` with `ISettingsProcessor`. It is 133 commits behind main and carries 30 unrelated refactors. Per the user's decision: **ignore the branch**, but lift those three good ideas here (see steps 3–4). Reference commits: `06510f73`, `d094a87d`, `ce02c10e`, `8fa797f2`.

## Requirements

- `settings.secrets` mergeable at root, group, conditional-group, and repo layers
- `inherit: false` clears inherited secrets; `SECRET_NAME: false` opts out of one
- `deleteOrphaned` is per-layer, innermost wins — same as `settings.variables.deleteOrphaned`
- Case-insensitive name matching preserved (GitHub treats secret names case-insensitively)
- `xfg sync` must **not** process secrets
- `xfg secrets sync` must **not** be blocked by "config has nothing to do" checks
- Old root-level `secrets:` produces a clear migration error, not a silent no-op

## Implementation

### 1. Types — `packages/xfg/src/config/types.ts`

- Add `SecretsConfig` named alias: `Record<string, SecretConfig | boolean> & { deleteOrphaned?: boolean }`, exported from the config barrel alongside `SecretConfig` (`packages/xfg/src/config/index.ts:33`). It is currently redeclared as a local `type` in two files — `secrets/processor.ts:12` and `cli/secrets-command.ts:22` — plus written inline in `RawConfig` and `Config`. Delete all four.
- `RawRootSettings` (`:471`): add `secrets?: SecretsConfig`
- `RawRepoSettings` (`:481`): add `secrets?: SecretsConfig & { inherit?: boolean }`
- `RepoSettings` (`:389`): add `secrets?: Record<string, SecretConfig> & { deleteOrphaned?: boolean }`
- **Remove** `secrets` from `RawConfig` (`:520`) and `Config` (`:558`)

### 2. Normalizer — `packages/xfg/src/config/normalizer.ts`

Secrets merge with the same rules as variables, only the value type differs (`SecretConfig` object vs `string`). Extract the shared shape rather than copy-pasting:

- `mergeVariablesCaseInsensitive` (`:213`) already takes and returns `Record<string, unknown>` — it is value-type agnostic today. **Rename** it to `mergeCaseInsensitiveEntries` and use it for both. Do not add a `<T>` wrapper; there is nothing to generalize.
- In `mergeSettings` (`:238`): add a secrets block mirroring the variables block at `:338-384` (inherit handling, `false` opt-outs, `deleteOrphaned` precedence, drop-if-empty).
- In `mergeRawSettings` (`:521`): add a secrets block mirroring the variables block at `:573-610`.
- Remove `secrets: raw.secrets` from the return of `normalizeConfig` (`:900`).

**No generics anywhere here.** Extract each ~45-line merge block into one shared non-generic helper over `Record<string, unknown>` — variables and secrets both call it. The values are already `unknown` at this layer, so a `<T>` parameter would buy nothing.

**Decision: `inherit: false` clears entries only, never `deleteOrphaned`.** The two existing variables blocks disagree on this today, and one shared helper forces a choice:

- Repo layer (`mergeSettings` `:343-350`): `deleteOrphaned` is resolved as a peer key *before* `inherit` is looked at, so root `deleteOrphaned: true` survives a repo `inherit: false`.
- Group layer (`mergeRawSettings` `:579-581`): `inherit: false` sets `baseVars = {}`, so the base `deleteOrphaned` is dropped along with the entries.

The repo-layer rule is the correct one and the shared helper must implement it. `deleteOrphaned` is a policy switch, not an entry — files, labels, and rulesets all treat it as a peer key that `inherit` never touches, and `docs/configuration/variables.md:91` documents `inherit: false` as "discard all inherited variables", not policy. A repo that wants cleanup off says `deleteOrphaned: false`
explicitly. Layer precedence for the switch stays innermost-wins.

This is a small behavioral change for **group-level variables**: root `deleteOrphaned: true` + group `inherit: false` used to silently disable orphan deletion for that group; now it stays on. Pin it with a test (TDD step 02b) and call it out in `docs/migration-v7.md`.

### 2b. Split config folders — a bug this fixes for free

`packages/xfg/src/config/config-merger.ts:10-18` defines `SINGLE_FILE_KEYS`: `id`, `files`, `prOptions`, `prTemplate`, `settings`, `githubHosts`, `deleteOrphaned`. **`secrets` is not in it.**

So today, a config split across a folder silently drops a root-level `secrets:` block — the merged config comes out with no secrets at all, and the user gets the confusing "Config requires at least one of: 'files', 'settings', or 'secrets'" error instead.

After this change secrets live under `settings:`, which **is** a single-file key, so they merge correctly. Free fix — but two things follow.

**The migration error needs a second home.** `mergeConfigFragments` (`:33-44`) copies only `SINGLE_FILE_KEYS` plus `repos`/`groups`/`conditionalGroups`. A fragment's root `secrets:` block is **dropped before validation ever sees it**, so by the time `validateRawConfig(merged)` runs (`packages/xfg/src/config/loader.ts:186`) `config.secrets` is `undefined` and the step-6f migration message never
fires. Split-folder users — precisely the ones who hit this — would get a confusing unrelated error. So: reject a root-level `secrets:` key inside `mergeConfigFragments` too, before the key is discarded. Step 1 removes `secrets` from `RawConfig`, so `config.secrets` will not compile there — read it via the same cast as step 6f: `(config as Record<string, unknown>).secrets !== undefined`.

**State the one-file rule precisely.** Only **root** `settings:` is single-file. `groups` and `repos` merge across files, so group-scoped and repo-scoped secrets can live in separate files just fine:

> In a split config folder, root-level `settings:` — and therefore any root-level secrets — must live in exactly one file. Group- and repo-scoped secrets can be spread across files as usual.

- Add a `config-merger` test: split folder with root `secrets:` → throws the migration error.
- Add a `config-merger` test: `settings.secrets` in one file, `repos:` in another → merges correctly.
- Put the precise rule (not the overstated version) in `docs/migration-v7.md`.

### 3. Move the module — `packages/xfg/src/secrets/` → `packages/xfg/src/settings/secrets/`

Colocates with the other settings processors and matches its existing import of `settings/base-processor.ts`. Update imports and re-export from `packages/xfg/src/settings/index.ts`. Move tests: `packages/xfg/test/unit/secrets/` → `packages/xfg/test/unit/settings/secrets/`.

**Test files needing YAML renested under `settings:`**, roughly by volume: `packages/xfg/test/unit/config/validator.test.ts` (most hits), `packages/xfg/test/unit/cli/secrets-command.test.ts`, `packages/xfg/test/integration/github-secrets.test.ts`, `packages/xfg/test/unit/config/normalizer.test.ts`, `packages/xfg/test/unit/secrets/processor.test.ts`.

Not `test/unit/error-sanitization.integration.test.ts` — its single `secrets` hit is an assertion that the string `"SECRET"` never reaches the logs. No config block, nothing to renest. Same for `test/unit/secrets/github-secrets-strategy.test.ts:38` — that `secrets:` is a mocked GitHub API response body, not xfg config. It moves with the directory but its contents stay as-is.

The move adds a directory level, so relative imports in the moved tests go from `../../../src/…` to `../../../../src/…`. `npm run test:typecheck` catches any miss.

### 4. Processor — `packages/xfg/src/settings/secrets/processor.ts`

Rewrite `SecretsProcessor` to implement `ISettingsProcessor` (`packages/xfg/src/settings/base-processor.ts:26`), matching `VariablesProcessor` (`packages/xfg/src/settings/variables/processor.ts`):

- Signature becomes `process(repoConfig, repoInfo, options)` — reads `repoConfig.settings?.secrets` instead of taking a flat config. **Do not** pass secrets via the constructor (the desloppify branch did this; it breaks per-repo scoping, which is the whole point here).

- Use `withGitHubGuards` (`base-processor.ts:71`) for the GitHub-only gate, empty check, and error wrap — deletes the hand-rolled versions at `processor.ts:47-57`. `withGitHubGuards` is generic over `TOptions extends BaseProcessorOptions`, so `SecretsProcessorOptions` (`processor.ts:16`, currently standalone) must `extends BaseProcessorOptions` or it won't compile.

- **`hasDesiredSettings` must keep `deleteOrphaned`-only configs alive.** Today `secrets-command.ts:88` lets `deleteOrphaned: true` with zero secret entries through — that's the "wipe every secret from this repo" case. Copy the variables guard verbatim (`packages/xfg/src/settings/variables/processor.ts:44-47`):

  ```ts
  hasDesiredSettings: (rc) => {
    const s = rc.settings?.secrets ?? {};
    const { deleteOrphaned, ...entries } = s as Record<string, unknown>;
    return Object.keys(entries).length > 0 || deleteOrphaned === true;
  }
  ```

  Get this wrong and orphan deletion silently stops working.

- Add `packages/xfg/src/settings/secrets/diff.ts` with `diffSecrets(current, desiredNames, deleteOrphaned)`, mirroring `variables/diff.ts`. Secrets always report `update` (never `unchanged`) — remote values are write-only, so we cannot tell if a value changed.

- Use `countActions` / `buildDryRunResult` / `buildApplyResult` from `base-processor.ts` — replaces the hand-rolled counting and summary strings at `processor.ts:93-176`.

- Result type extends `BaseProcessorResult`, and every added field **must be optional** — `changes?: ChangeCounts`, matching `VariablesProcessorResult` (`variables/processor.ts:27`). `base-processor.ts:55-58` spells out why: `baseResult<TResult>` is a cast used for guard early-returns, so a required field would be a lie at runtime. Today's `SecretsProcessorResult` (`processor.ts:28-30`) has
  `created`/`updated`/`deleted` required — that must not carry over.

**This changes the result shape.** Today `SecretsProcessorResult` carries flat `created` / `updated` / `deleted` numbers; after the move they live in `changes: ChangeCounts`. Nothing in `src/` reads the flat fields, so this is safe — but tests do: `test/unit/secrets/processor.test.ts` asserts them in 16 places (`:121`, `:153-154`, `:175`, `:196`, `:235-236`, `:255`, `:318-319`, `:341-343`,
`:379-381`), and `test/unit/cli/secrets-command.test.ts:18-24` builds them as a literal. Those become `result.changes.create` / `.update` / `.delete`.

### 5. Command — `packages/xfg/src/cli/secrets-command.ts`

- Update `ISecretsProcessorAdapter` (`:26-32`) to the new `process(repoConfig, repoInfo, options)` signature — it mirrors the processor and must move with it.
- Drop the `config.secrets` early-return (`:79-92`). **Do not** hand-roll a per-repo empty check to replace it — `withGitHubGuards` (`base-processor.ts:88`) already returns `skipped: true` when `hasDesiredSettings` is false, which is exactly how `VariablesProcessor` handles this. Keep only the "every repo came back empty → log 'No secrets configured' once" case.
- **Don't log per-repo skips for empty secrets.** Today no repo is ever skipped, because secrets are global. After scoping, every repo without secrets returns `skipped: true` and would print a "skip" line via `logger.skip` (`packages/xfg/src/shared/logger.ts:102`) — a 50-repo config with secrets on 3 repos would emit 47 lines of noise. In the loop, treat `result.skipped` from the
  *no-secrets-configured* case as silent (still counted in `logger` stats); keep logging the *not-a-GitHub-repo* skip, which is the existing informative one. The two are distinguishable by `result.message`; prefer adding a discriminator field on the result over matching strings.
- Remove the `validateVariableSecretOverlaps` call at `:76` — superseded by the post-normalize check (step 6a). `validateSecretsConfig` at `:75` stays, but now walks settings layers.
- Drop the `validateRawConfig` call at `:74` while here — `loadRawConfig` already calls it (`packages/xfg/src/config/loader.ts:70`), so it runs twice today. Harmless, but free to clean up.
- Pass `repoConfig` (not `config.secrets`) into `processor.process` (`:111`).
- **Leave the token read at `:97` alone.** An earlier draft proposed swapping it for `resolveGitHubToken`. That is not a refactor — it is adding GitHub App support to the secrets command, and it is a behavior trap: `resolveGitHubToken` with no `tokenManager` returns `envToken` verbatim (`packages/xfg/src/shared/gh-token-utils.ts:32`), so passing only `GH_TOKEN` silently drops today's
  `GITHUB_TOKEN` fallback. It also takes `repoInfo`, forcing the call inside the per-repo loop. Out of scope — separate PR.
- `createDefaultProcessor` no longer needs the `_config` param.
- Add the post-normalize overlap check after `normalizeConfig` (`:77`) — see step 6.

### 6. Validator — `packages/xfg/src/config/validator.ts`

Three traps here. Each one is a silent regression if handled naively.

**6a. Overlap check must run on MERGED settings, not raw layers.**

Today secrets are global, so every layer's variables get compared against the full secret set. After the move, a per-layer loop only catches collisions *within* one layer — this would slip through:

```yaml
settings:
  secrets:
    MY_KEY: { env: X }
repos:
  - git: ...
    settings:
      variables:
        MY_KEY: hello      # collides at GitHub; a per-layer check says OK
```

So: **do not** collapse `validateVariableSecretOverlaps` (`:353-453`) into a loop over raw layers. Replace it with a new `validateNormalizedConfig(config: Config)` that iterates `config.repos` and compares `repo.settings.variables` against `repo.settings.secrets` — post-merge, where the real collision lives. Call it right after `normalizeConfig` in **both** entry points:
`packages/xfg/src/cli/sync-command.ts:110` and `packages/xfg/src/cli/secrets-command.ts:77`. Export it from the config barrel next to `validateSecretsConfig` (`packages/xfg/src/config/index.ts:58`) so both call sites import through the barrel rather than reaching into `validator.js` directly, as `secrets-command.ts:6` does today.

**Two traps in the comparison itself:**

- **Strip the meta keys first.** Post-merge, both `settings.variables` and `settings.secrets` still carry `deleteOrphaned` *inside the map*. A naive key intersection reports *"deleteOrphaned overlaps between variables and secrets"* for any config that sets it on both — a pure false positive. Filter out `deleteOrphaned` and `inherit` from both sides before comparing.
- **Also check `config.settings`.** The loop over `config.repos` never runs when `repos: []`, so a root-level collision would slip through — something today's raw check does catch. Add a pass over the normalized root settings (`normalizeConfig` already produces it via `mergeSettings(raw.settings, undefined)` at `normalizer.ts:891`).

**Remove the old inline calls — in both places.** `validateForSync` invokes `validateVariableSecretOverlaps` at `:350`, and `secrets-command.ts` calls it again at `:76`. Both go, or the stale per-layer logic keeps running alongside the new check. (`validateSecretsConfig` survives at `validator.ts:347` and `secrets-command.ts:75`, rewritten to walk settings layers.)

The four near-identical raw-layer blocks still collapse — into one post-normalize loop, and a stronger one. Error messages should name the repo.

**6b. `validateRawConfig` must learn about per-repo settings.**

`validateRawConfig` (`:202-234`) checks root files, root settings, group files, group settings, cond-group files/settings/PR, and `hasSecrets` (`:218`). It **never checks `config.repos[].settings`** — that check only exists in `validateForSync` (`:271-273`), which `xfg secrets sync` never calls.

So dropping `hasSecrets` outright would make this throw "Config requires at least one of…":

```yaml
repos:
  - git: ...
    settings:
      secrets:
        MY_KEY: { env: X }
```

Replace `hasSecrets` with a per-repo settings presence check, don't just delete it. Update the error text to drop the now-invalid root-level `'secrets'` suggestion.

**Guard the array access.** This check lands at `:216`, but `config.repos` is not verified to be an array until `:249`. A config with no `repos:` would throw a raw `TypeError` instead of the friendly ValidationError:

```ts
Array.isArray(config.repos) && config.repos.some((r) => isPlainObject(r.settings))
```

**6c. Root-level `inherit` guard for secrets.**

`validateRootSettings` (`:89-93`) rejects `inherit` in root-level variables — "nothing to inherit from". Root secrets need the identical guard; the plan's `RawRootSettings.secrets` type has no `inherit`, but the validator is what actually enforces it at runtime.

**6d. Extract `collectAllSettings` before reusing it.**

The `allSettings` array (`:301-306`) lives *inside* `validateForSync`, which `xfg secrets sync` does not call. Pull it out into a module-level `collectAllSettings(config: RawConfig)` helper first, then use it from both `validateForSync` and `validateSecretsConfig`.

**6e. Per-layer validation in the second validator module.**

There is a second validator the earlier drafts missed: `packages/xfg/src/config/validators/shared.ts:342`. `validateSettings(settings, context, rootCtx)` walks each settings layer and produces context-rich errors ("Repo X: …") for rulesets, labels, repo, codeScanning. Add a `validateSettingsSecrets(settings, context)` call alongside them.

Not a blocker — `validateSecretsConfig` still catches bad names — but errors would otherwise lack the layer context. Note that `variables` has the same gap today; adding secrets here is a small improvement over matching the existing behavior.

**Also:**

- `validateSecretsConfig` (`:534`): walk all settings layers via `collectAllSettings` instead of only `config.secrets`. Name validation and the reserved-key check apply per layer.

  **`inherit` must become a reserved secret key — this is a live bug otherwise.** The function destructures out `deleteOrphaned` (`:536`) but nothing else, then rejects any `true` value at `:547`. So `secrets: { inherit: true }` on a repo throws *"Secret 'inherit' is set to true, which is not valid"* — nonsense. Variables already solve this with `VARIABLE_RESERVED_KEYS` (`validator.ts:23`). Add
  `SECRET_RESERVED_KEYS = new Set(["deleteOrphaned", "inherit"])` and skip both in the `true` check (`:546-552`) and the duplicate-name check (`:555-565`). Needs its own test.

- `hasActionableSettings` (`:457`): **must NOT count secrets.** A secrets-only config should leave `xfg sync` with nothing to do. Add a comment stating this, since the omission looks like a bug.

**6f. Migration error must fire FIRST.**

Add the root-level-`secrets:` error at the **top of `validateRawConfig`**, before the "Config requires at least one of…" check at `:221`. Otherwise an old config (root `secrets:`, nothing else) trips the generic "nothing to do" error and the user never sees the migration message.

Since step 1 removes `secrets` from `RawConfig`, reading it needs a cast: `(config as Record<string, unknown>).secrets !== undefined`. Point the message at `docs/migration-v7.md`.

### 7. Schema — `config-schema.json`

- Delete the root-level `secrets` property (`:69-91`).
- Add `secrets` to both the root-settings definition (near `variables` at `:618`) and the `repoSettings` definition (near `variables` at `:723`) — repo-level gets the extra `inherit` flag, same split as variables. **Two edits cover everything**: `repoSettings` is `$ref`'d at `:236`, `:439`, and `:528`, so repos, groups, and conditional groups all pick it up.
- Keep the `secretConfig` definition as-is.
- **The root object has no `additionalProperties: false`**, so editors will *not* flag an old root-level `secrets:` block. The validator's migration error (step 6) is the only signal users get — it must fire reliably.

### 8. Docs

- `docs/configuration/secrets.md`: rewrite the intro (`:3`) — remove "cannot be defined per-repo or per-group"; renest every example under `settings:`; add a scoping section showing group + per-repo + `inherit: false` + `NAME: false`.
- `docs/migration-v7.md`: new file, following the structure of `docs/migration-v5.md` (there is no v6 doc — only v4 and v5 exist). Current version is 6.4.7, so v7 is the right name. Show the before/after above and the error message users will hit. Also document the step-2 variables change: group-level `inherit: false` no longer clears an inherited `variables.deleteOrphaned`; set
  `deleteOrphaned: false` explicitly to opt out.
- `docs/reference/config-schema.md`: prose at `:48` (the root-level `secrets` table row) and `:87` ("The `secrets` object is at the **root level** (not under `settings`)") — both now wrong.
- `mkdocs.yml:114-116`: add `- v6 to v7: migration-v7.md` to the Migration nav, above the v5 entry. Without this the new page ships unlinked.
- `README.md`: renest if any secrets example appears there.

**Do NOT renest these** — none contains an xfg `secrets:` config block, so there is nothing to move. Re-check each rather than trusting the reason, since they differ:

- Pure GitHub Actions `${{ secrets.X }}` expressions, unrelated to xfg config — editing them would break working CI examples: `docs/security/secret-rotation.md`, `docs/use-cases.md`, `docs/examples/env-specific.md`, `docs/ci-cd/github-actions.md`, `docs/platforms/github-app.md`.
- `docs/reference/cli-options.md:72-101` — real `xfg secrets sync` prose, but CLI flags and shell examples only, no YAML. Verify nothing there implies a root-level key.
- `docs/configuration/repo-settings.md:76` — the `secretScanningPushProtection` table row. Unrelated feature.
- Commit with a `feat!:` / `BREAKING CHANGE:` footer so release-please cuts a major.

## TDD order

Per `.claude/rules/tdd.md` — red first, one behavior at a time:

There are **two** merge functions and the tests must hit both: `mergeSettings` (`normalizer.ts:238`, repo layer) and `mergeRawSettings` (`normalizer.ts:521`, group + conditional-group layers).

01. Normalizer test: group-level secrets merge into a repo in that group → fails → implement `mergeRawSettings` secrets block
02. Normalizer test: `inherit: false` on a **group** layer clears root secrets (exercises `mergeRawSettings`, not `mergeSettings`) → fails → implement 02b. Normalizer test (**variables**, not secrets): root `variables.deleteOrphaned: true` + group `variables: { inherit: false, X: "1" }` → merged repo still has `deleteOrphaned: true` (pins the step-2 decision; genuinely red today because the group
    layer drops it) → fails → implement the shared helper with peer-key `deleteOrphaned`
03. Normalizer test: `inherit: false` on a **repo** layer clears inherited secrets (exercises `mergeSettings`) → fails → implement
04. Normalizer test: `SECRET_NAME: false` opts out of one inherited secret → fails → implement
05. Normalizer test: repo `deleteOrphaned` overrides root → fails → implement
06. Config-merger test: split folder with a root `secrets:` block throws the migration error (step 2b — the key is dropped before validation today, so this is genuinely red) → fails → implement the rejection in `mergeConfigFragments` 6b. Config-merger test (happy path): `settings.secrets` in one file, `repos:` in another, merges into a config where every repo gets the secret
07. Validator test: root secret + per-repo variable of the same name throws (hole 6a) → fails → implement `validateNormalizedConfig` 7b. Validator test: `deleteOrphaned: true` on **both** variables and secrets does NOT throw (the false-positive trap) → fails → implement the meta-key strip 7c. Validator test: root-level variable/secret collision with `repos: []` still throws → fails → implement the
    root-settings pass
08. Validator test: a config with secrets **only** under `repos[].settings` passes `validateRawConfig` (hole 6b) → fails → implement the per-repo settings check
09. Validator test: a config with secrets but **no `repos:` key** throws ValidationError, not `TypeError` (hole 6b guard) → fails → implement `Array.isArray` guard
10. Validator test: `inherit: false` in a **repo** secrets block is accepted, not mistaken for a secret named `inherit` (the `SECRET_RESERVED_KEYS` bug) → fails → implement
11. Validator test: `inherit` in **root-level** secrets throws "nothing to inherit from" (hole 6c) → fails → implement
12. Validator test: a config with **only** root-level `secrets:` throws the *migration* error, not "Config requires at least one of…" (hole 6f — ordering) → fails → implement
13. Validator test: secrets-only config leaves `hasActionableSettings` false → fails → implement
14. Processor tests: port `test/unit/secrets/processor.test.ts` to the new signature **and** the new result shape — the 6 flat `result.created` / `.updated` / `.deleted` assertions become `result.changes.create` / `.update` / `.delete`
15. `diffSecrets` unit tests (create / update / delete-orphan / no-delete)
16. Command test: a repo with no merged secrets comes back `skipped` via `withGitHubGuards` and logs **nothing**; a repo with secrets is processed; a non-GitHub repo still logs its skip

## Verification

**Before starting:** `main` has uncommitted edits to `packages/xfg/PR.md`, five `test/fixtures/expected/*.json` files, and both tsconfigs. Stash or commit them separately first, then branch from a clean `main`, or they ride along into this PR.

From `packages/xfg/`:

```bash
npm run build
npm test
npm run test:typecheck
```

From repo root:

```bash
./lint.sh
```

Manual smoke test — proves the actual scoping works:

```bash
# config with root + group + per-repo secrets across 2+ repos
XFG_TEST_SECRET_VALUE=x node dist/index.js secrets sync --config <config.yaml> --dry-run
```

Confirm the dry-run plan shows **different** secret sets per repo, and that names appear but values never do.

Then confirm `xfg sync` ignores secrets entirely:

```bash
node dist/index.js sync --config <same config.yaml> --dry-run
```

No secret names should appear in that output.

Integration tests (behavioral change, per the pre-PR checklist):

```bash
npm run test:integration:github    # required — extend github-secrets.test.ts with a group-scoped case
npm run test:integration:ado
npm run test:integration:gitlab
```

`packages/xfg/test/integration/github-secrets.test.ts` needs its configs renested under `settings:`, plus one new case: two repos, a secret scoped to only one group, asserting the other repo does not get it.

## Documented sharp edge

`inherit: false` plus `deleteOrphaned: true` on the same repo is destructive in a way that reads innocent:

```yaml
settings:
  secrets:
    SHARED_KEY: { env: SHARED }
repos:
  - git: git@github.com:org/isolated.git
    settings:
      secrets:
        inherit: false          # SHARED_KEY is no longer desired here
        deleteOrphaned: true    # ...so it gets deleted from the repo
        OWN_KEY: { env: OWN }
```

This is correct behavior — `inherit: false` makes root secrets undesired, and `deleteOrphaned` removes undesired secrets — but the two flags interacting is not obvious. Call it out explicitly in `docs/configuration/secrets.md` with this exact example, in a `!!! danger` block matching the style of the existing one at `docs/configuration/secrets.md:124`. No code change; documentation only.

## Out of scope

- Org-level and environment-level secrets (GitHub supports both; this change is repo-level only)
- Any change to encryption or env-var resolution
- GitHub App token support in `xfg secrets sync` (the `resolveGitHubToken` swap) — separate PR
- Merging or rebasing `chore/desloppify`
