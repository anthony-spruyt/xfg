# Secret Rotation Documentation Design

**Date:** 2026-02-22
**Status:** Approved

## Overview

Add secret rotation documentation to two locations:

1. **`DEVELOPMENT.md`** — For contributors rotating their local dev credentials
2. **`docs/security/secret-rotation.md`** — For xfg end-users rotating CI/CD credentials

## Approach

Approach A: Group by credential type in both files, with content tailored to each audience.

## DEVELOPMENT.md Section

**Placement:** New `## Secret Rotation` section after "Platform Authentication" (around line 296).

**Recommended schedule table:**

| Credential                  | Recommended Schedule |
| --------------------------- | -------------------- |
| GH_TOKEN (PAT)              | Every 90 days        |
| SSH keys                    | Annually             |
| Azure DevOps session        | Every 90 days        |
| GitLab session              | Every 90 days        |
| CONTEXT7_API_KEY / MCP keys | Per provider policy  |

**Subsections (3-6 steps each):**

1. **SSH Keys** — Generate new key, update GitHub/GitLab, update `allowed_signers`, update signing config, remove old key.
2. **GH_TOKEN (GitHub PAT)** — Generate new token, update `~/.secrets/.env`, verify with `gh auth status`.
3. **Azure DevOps** — Re-authenticate with `az login`.
4. **GitLab** — Re-authenticate with `glab auth login`, or rotate PAT.
5. **Dev Environment API Keys** — CONTEXT7_API_KEY and other MCP keys: regenerate from provider dashboard, update `~/.secrets/.env`.

Content is purely procedural — rotation steps only, no detection/symptom guidance.

## docs/security/secret-rotation.md Page

**Audience:** xfg end-users running xfg in CI/CD.

**Schedule table** — Same as DEVELOPMENT.md plus:

| Credential                    | Recommended Schedule |
| ----------------------------- | -------------------- |
| GitHub App private key (.pem) | Every 6 months       |

**Subsections:**

1. **GitHub PAT (GH_TOKEN)** — Rotate token in GitHub Actions secrets, verify workflow.
2. **GitHub App Private Key** — Generate new key in App settings, update `APP_PRIVATE_KEY` secret, delete old key.
3. **Azure DevOps** — Rotate PAT or service principal, update CI variables.
4. **GitLab** — Rotate PAT or project access token, update CI variables.
5. **Dev Environment Keys** — Link to DEVELOPMENT.md for local credential rotation.
6. **Post-Rotation Verification** — `xfg sync --dry-run` to confirm new credentials work.

## Design Decisions

- **Two files, not one:** Contributors and CI/CD users have different credentials and workflows.
- **Grouped by credential type, not platform:** SSH and GH_TOKEN span platforms; grouping by type avoids duplication.
- **Concrete schedules included:** Users requested specific recommendations rather than vague "rotate regularly" guidance.
- **No detection content:** Purely procedural — how to rotate, not how to know when.
- **Dev environment API keys included:** CONTEXT7_API_KEY and other MCP server keys covered alongside platform credentials.
