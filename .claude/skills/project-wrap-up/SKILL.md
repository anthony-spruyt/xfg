---
name: project-wrap-up
description: >-
  Wrap up a finished large workstream: write the blog post about it, then tidy up.
  Use when a large workstream has just finished, or the owner says wrap up the project or workstream.
  Not for subagents, small fixes, or work still in progress.
---

# Project Wrap-Up

Main session only: a helper can't talk to the owner.

A large workstream ends in two things: a blog post about how it went, and a tidy trail. The post goes to `anthony-spruyt/blog` as a PR; the owner reviews and merges it.

## 1. Gather the story

Read the tracking issue and its comments, the PRs, the commits, the review rounds and the progress notes. Note the dead ends, wrong turns and surprises: they are the middle of the story. Leave out security-lens review findings and anything from `anthony-spruyt/security`.

## 2. Ask the owner

Three open questions, one message at a time:

- What surprised you?
- What would you do again, and what not?
- What does this save compared with a paid SaaS?

Play their answers back. Only what they said goes in as theirs.

## 3. Draft the post

Get the post written from the story, the owner's answers and this blog context (the owner's words):

- Readers are home labbers, builders, maybe a future employer.
- Tone: an honest build journey. The messy middle and dead ends stay in. Not bragging, not pretentious.
- Theme: build it yourself, cheap and self-hosted, instead of paying for SaaS, and learn on the way.
- Openly co-written. Byline "Anthony Spruyt & Claude". The guardrails behind the agentic work are part of the story.
- The post lives at `content/posts/<slug>.md` in `anthony-spruyt/blog` (Hugo + PaperMod).
- Slugs and asset names avoid the words `login` and `signin`.
- Never hardcode the domain in post text; link relative.

The draft is committed locally in a blog clone: not pushed, no PR.

## 4. Review and hand over

A PR in a public repo is public the moment it opens, so the draft is checked against the blog context in step 3 and the exclusions in step 1, and reviewed on the committed diff, before the PR opens. Open the PR only once the review passes. Hand it to the owner once CI is green; the owner reviews and merges.

## 5. Tidy up

- Close the tracking issue only after validated success.
- Delete your own session notes and the notes named for this workstream's issue; leave other sessions' notes.
- Write a short lessons list for the owner: what worked, what cost time.
- A lesson that would change a rule, skill, agent or hook is a suggestion for the owner. Never edit those files from here.
