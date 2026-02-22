# Secret Rotation Documentation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add secret rotation documentation to DEVELOPMENT.md (contributors) and docs/security/secret-rotation.md (CI/CD users).

**Architecture:** Two independent doc files — DEVELOPMENT.md gets a new section inserted between "Platform Authentication" and "Development Commands"; docs site gets a new page under a new "Security" nav section. mkdocs.yml updated to include the new page.

**Tech Stack:** Markdown, MkDocs (Material theme)

---

### Task 1: Add Secret Rotation section to DEVELOPMENT.md

**Files:**

- Modify: `DEVELOPMENT.md:296` (insert new section before `## Development Commands`)

**Step 1: Add the section**

Insert the following after line 295 (end of "Platform Authentication" / before `## Development Commands`) in `DEVELOPMENT.md`:

````markdown
## Secret Rotation

Rotate credentials regularly to limit the blast radius of a compromise.

| Credential                  | Recommended Schedule                  |
| --------------------------- | ------------------------------------- |
| GH_TOKEN (GitHub PAT)       | Every 90 days                         |
| SSH keys                    | Annually                              |
| Azure DevOps session        | Every 90 days                         |
| GitLab session              | Every 90 days                         |
| CONTEXT7_API_KEY / MCP keys | Per provider policy (check dashboard) |

### SSH Keys

1. Generate a new key:

   ```bash
   ssh-keygen -t ed25519 -C "you@example.com" -f ~/.ssh/id_ed25519_new
   ```
````

2. Add the new public key to GitHub at [SSH and GPG keys](https://github.com/settings/keys) (both as an **authentication key** and, if you sign commits, a **signing key**).

3. Update the allowed signers file:

   ```bash
   sed -i "s|$(cat ~/.ssh/id_ed25519.pub)|$(cat ~/.ssh/id_ed25519_new.pub)|" ~/.ssh/allowed_signers
   ```

4. Update git signing config (if signing commits):

   ```bash
   git config --global user.signingkey "$(cat ~/.ssh/id_ed25519_new.pub)"
   ```

5. Replace the old key:

   ```bash
   mv ~/.ssh/id_ed25519_new ~/.ssh/id_ed25519
   mv ~/.ssh/id_ed25519_new.pub ~/.ssh/id_ed25519.pub
   ```

6. Re-add the key to your SSH agent:

   ```bash
   # macOS
   ssh-add --apple-use-keychain ~/.ssh/id_ed25519
   # Linux/WSL
   ssh-add ~/.ssh/id_ed25519
   ```

7. Remove the old public key from GitHub after confirming the new key works:

   ```bash
   ssh -T git@github.com
   ```

### GH_TOKEN (GitHub PAT)

1. Generate a new classic token at [GitHub Settings > Personal access tokens (classic)](https://github.com/settings/tokens) with `repo` and `workflow` scopes.

2. Update `~/.secrets/.env`:

   ```text
   GH_TOKEN=<new-token>
   ```

3. Rebuild the devcontainer to pick up the new token (Command Palette > "Dev Containers: Rebuild Container").

4. Verify:

   ```bash
   gh auth status
   ```

### Azure DevOps

Azure CLI uses browser-based login. Re-authenticate when your session expires:

```bash
az login
```

### GitLab

Re-authenticate when your session or token expires:

```bash
glab auth login
```

If using a personal access token, generate a new one in GitLab > User Settings > Access Tokens, then re-run `glab auth login` with the new token.

### Dev Environment API Keys

For CONTEXT7_API_KEY and other MCP server API keys:

1. Regenerate the key from the provider's dashboard (e.g., [context7.com](https://context7.com) for CONTEXT7_API_KEY).

2. Update `~/.secrets/.env`:

   ```text
   CONTEXT7_API_KEY=<new-key>
   ```

3. Rebuild the devcontainer to pick up the new value.

````

**Step 2: Verify the file renders correctly**

Run: `npx prettier --check DEVELOPMENT.md`
Expected: PASS (no formatting issues)

**Step 3: Commit**

```bash
git add DEVELOPMENT.md
git commit -m "docs: add secret rotation section to DEVELOPMENT.md"
````

---

### Task 2: Create docs/security/secret-rotation.md

**Files:**

- Create: `docs/security/secret-rotation.md`

**Step 1: Create the directory and file**

Create `docs/security/secret-rotation.md` with:

````markdown
# Secret Rotation

Rotate credentials used by xfg regularly to limit the blast radius of a compromise.

## Recommended Schedules

| Credential                           | Recommended Schedule |
| ------------------------------------ | -------------------- |
| GH_TOKEN (GitHub PAT)                | Every 90 days        |
| GitHub App private key (.pem)        | Every 6 months       |
| Azure DevOps PAT / service principal | Every 90 days        |
| GitLab PAT / project access token    | Every 90 days        |
| CONTEXT7_API_KEY / MCP keys          | Per provider policy  |

## GitHub PAT (GH_TOKEN)

1. Generate a new classic token at [GitHub Settings > Personal access tokens (classic)](https://github.com/settings/tokens) with `repo` and `workflow` scopes.

2. Update the secret in your CI environment:
   - **GitHub Actions:** Repository > Settings > Secrets and variables > Actions > Update `GH_TOKEN`
   - **Azure Pipelines:** Pipeline > Edit > Variables > Update `GH_TOKEN`
   - **GitLab CI:** Settings > CI/CD > Variables > Update `GH_TOKEN`

3. Trigger a test run to verify the new token works.

## GitHub App Private Key

1. Go to your GitHub App settings > General > Private keys.

2. Click **Generate a private key** to create a new `.pem` file.

3. Update the `APP_PRIVATE_KEY` secret in your CI environment with the contents of the new `.pem` file.

4. Trigger a test run to confirm xfg can authenticate with the new key.

5. Delete the old private key from the GitHub App settings page.

See [GitHub App Authentication](../platforms/github-app.md) for full setup details.

## Azure DevOps

### Personal Access Token

1. Generate a new PAT in Azure DevOps > User Settings > Personal access tokens.

2. Update the token in your CI environment variables.

3. Verify with a test run.

### Service Principal

1. Rotate the client secret in Azure AD > App registrations > your app > Certificates & secrets.

2. Update the secret in your CI pipeline variables.

## GitLab

### Personal Access Token

1. Generate a new PAT in GitLab > User Settings > Access Tokens.

2. Update the token in your CI environment variables.

3. Verify with a test run.

### Project Access Token

1. Generate a new token in your project > Settings > Access Tokens.

2. Update the token in your CI/CD variables.

## Dev Environment Keys

For local development credentials (CONTEXT7_API_KEY, SSH keys, platform CLI sessions), see the [Secret Rotation section in DEVELOPMENT.md](https://github.com/anthony-spruyt/xfg/blob/main/DEVELOPMENT.md#secret-rotation).

## Post-Rotation Verification

After rotating any credential, run a dry-run sync to confirm xfg can authenticate without making changes:

```bash
xfg sync --config <config.yaml> --dry-run
```
````

Check the output for authentication errors before running a real sync.

````

**Step 2: Verify the file renders correctly**

Run: `npx prettier --check docs/security/secret-rotation.md`
Expected: PASS

**Step 3: Commit**

```bash
git add docs/security/secret-rotation.md
git commit -m "docs: add secret rotation page for CI/CD users"
````

---

### Task 3: Update mkdocs.yml navigation

**Files:**

- Modify: `mkdocs.yml:102` (add Security section to nav)

**Step 1: Add Security nav entry**

In `mkdocs.yml`, add a new nav section after `Troubleshooting` (line 102) and before `IDE Integration`:

```yaml
- Security:
    - Secret Rotation: security/secret-rotation.md
```

The resulting nav block (lines 102-104) should look like:

```yaml
- Troubleshooting: troubleshooting.md
- Security:
    - Secret Rotation: security/secret-rotation.md
- IDE Integration: ide-integration.md
```

**Step 2: Verify mkdocs config is valid**

Run: `npx prettier --check mkdocs.yml`
Expected: PASS

**Step 3: Commit**

```bash
git add mkdocs.yml
git commit -m "docs: add security section to mkdocs navigation"
```

---

### Task 4: Final verification

**Step 1: Run linting**

Run: `./lint.sh`
Expected: PASS

**Step 2: Verify all new content is committed**

Run: `git status`
Expected: clean working tree

**Step 3: Push and create PR**

```bash
git push -u origin docs/secret-rotation
gh pr create --title "docs: add secret rotation documentation" --body "$(cat <<'EOF'
## Summary
- Add secret rotation section to DEVELOPMENT.md covering SSH keys, GH_TOKEN, Azure/GitLab sessions, and dev API keys (CONTEXT7_API_KEY)
- Add docs/security/secret-rotation.md for CI/CD users covering PATs, GitHub App keys, and platform tokens
- Add Security nav section to mkdocs.yml

## Test plan
- [ ] Verify DEVELOPMENT.md renders correctly on GitHub
- [ ] Verify docs site builds with `mkdocs serve`
- [ ] Verify all links resolve correctly
- [ ] Check rotation steps are accurate for each platform

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr merge --auto --squash --delete-branch
```
