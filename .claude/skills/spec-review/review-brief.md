# Spec Review Brief

Perform critical architectural and technical review of the provided spec file.

## Review scope

For each architectural area in the spec, identify gaps, risks, incorrect assumptions, and over-engineering. Focus on:

- **Shared infrastructure impact** — how new components affect existing consumers, blast radius, resource contention
- **Coordination correctness** — dedup, race conditions, state machine transitions, failure recovery semantics
- **Security model** — credential separation, access-control alignment, network policy coverage
- **Integration reliability** — callback patterns, failure modes during restarts, state tracking across components
- **External service assumptions** — free-tier limitations, API behavior under concurrency, dependency chains
- **Safety mechanisms** — loop prevention, circuit breakers, TTL correctness, cascading failure scenarios
- **Deployment** — resource sizing, lifecycle, alignment with the existing configuration
- **Phase sequencing** — dependency ordering, what's deferred that shouldn't be, what's premature

## Verify against the repo and live systems

The spec's claims about existing infrastructure may not match what is deployed, so check each one:

- Find and read the actual code and config in the repo for any component the spec references
- Verify current configs and capabilities of referenced services
- Check live state where the repo alone is insufficient
- Follow the repo's `.claude/spec-review.md`, if it exists, for where and how to verify claims

Use Context7 for library/framework docs. Where a finding depends on what is deployed, cite the file you read.

## Before flagging a finding

Specs often address risks in dedicated sections (e.g., "Risks and Mitigations", phase checklists, tradeoff callouts). Before raising a finding:

1. **Search the full spec** for the concern — check the risks table, implementation phases, operational notes, and inline tradeoff discussions
2. **If the spec already identifies and addresses the concern** — do NOT flag it. It's not a finding, it's a design decision the author already made
3. **If the spec identifies the concern but the mitigation is inadequate** — flag the mitigation gap, not the concern itself. Cite where the spec addresses it and explain why the mitigation falls short
4. **Only flag concerns the spec genuinely misses** — no credit for re-discovering what the author already documented

A review that re-raises addressed risks wastes author time and erodes trust in the review process.

## Output format

Structure findings as:

1. **Critical** — blocks implementation or risks data loss/cascading failure
2. **Major** — significant design gap or incorrect assumption about existing infra
3. **Minor** — improvement opportunities, over-engineering, or unclear spec language
4. **Validated** — spec claims verified correct against the repo and live state

For each finding: state the problem, cite the spec section, show evidence (file snippet or doc reference), and suggest a fix.
