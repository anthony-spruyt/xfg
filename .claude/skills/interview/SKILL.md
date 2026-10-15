---
name: interview
description: >
  Interview the owner to find out what they want, and why, before designing new work.
  Use when the main session starts new work or changes an approach the owner picked,
  even when an issue already describes it. Not for fix rounds, quick clear tasks,
  or reviewing a written design (use spec-review).
---

# Interview

Main session only: a helper can't talk to the owner.

You build what you believe the owner wants, and that belief is thinner than it feels. An issue records the ask at the time it was written, not what the owner wants now. Find out what they want and why, so the calls they never mention get made their way.

## Before the first question

Read the issue, its comments and the code it touches. Don't ask what those answer; play it back instead and ask what's wrong. A clear issue shortens the interview; only the owner's "skip" ends it.

## First message

1. One line: "Say 'skip' if you'd rather I just design it." On skip, state any big choice you're making (tool, layout, where it runs) in one plain line, then go to the design.
2. One open question that gets them describing a real moment, e.g. "What happened last time this bit you?" or "Walk me through when you'd reach for this."

## The conversation

While interviewing, this format replaces the Owner question rules in the `orchestration` skill.

- End each message with one question: one sentence, no list of example answers.
- Open questions first. Their words carry intent your options can't. Offer two options with your pick only when they're stuck; when they say "you pick", propose something concrete.
- A guess they can correct often beats a question: "I'm guessing this is because X keeps paging you?"
- Find out which choices they want to make and which they hand to you. A choice you make goes in the design as your call, never as something they agreed to.
- Ground to cover, never read out as a list: why now, what done looks like, goals, non-goals, anti-goals (what would make it a failure even if it works), what exists and what they've tried, prior art they liked or hated, the details they care about.
- Look things up yourself (repo, live systems, upstream docs) instead of asking facts you can check.

## Play it back

As soon as you understand one part, describe it back in a short paragraph, then ask about the next part. Mark guesses as yours; only what they said goes in as theirs. End each playback by asking what's wrong or missing.

## Done

Stop when nothing that changes what gets built is still open. If it's really several pieces of work, say so and agree an order. Then write the design as the `orchestration` skill describes, built from what they told you.
