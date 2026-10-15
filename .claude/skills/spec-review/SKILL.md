---
name: spec-review
description: >
  Architectural and technical review of a design spec against the repo and the live systems it describes.
  Use when the user asks to review, check, or critique a spec, design doc, or plan file
  before implementation. Not for code diffs or PRs (use code-review).
argument-hint: <spec-file-path>
arguments: [spec]
---

# Spec Review

You are reviewing the spec at `$spec`.

## Instructions

1. Read the review brief at [review-brief.md](review-brief.md)
2. Read the full spec at `$spec`
3. Spawn a general-purpose subagent to perform the review. Brief it with:
   - The full review brief contents
   - The spec file path to review
   - Instruction to use Context7 for library/framework validation
   - Instruction to verify the spec's claims against the code and config in the repo, and against live systems where the repo alone is insufficient
   - The contents of `.claude/spec-review.md` in the repo, if it exists: where and how to verify claims in this repo
   - Instruction to cross-reference findings against the spec's own risks table, phase checklists, and tradeoff callouts before flagging — do not raise concerns the spec already addresses
4. After receiving findings, present results organized by severity
5. Offer to update the spec based on findings

## Rules

- Findings go in the conversation, not the spec. Don't append review notes, summaries, or review round logs to the spec file: it is the design document, not a review journal.
- Only edit the spec to fix actual issues identified in findings (incorrect claims, missing sections, design gaps). Each edit should improve the spec's content, not add meta-commentary about the review process.
