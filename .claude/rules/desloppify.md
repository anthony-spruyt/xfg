# Desloppify Rules

## Scanning

**NEVER use `--force-rescan`.** It resets plan state, reopens all chronic false positives, and tanks the strict score. Work through the queue instead — if the queue has subjective re-review items, resolve them or skip them, then scan normally.

## False Positives

**NEVER use `--permanent` (wontfix) for false positives.** Use `--false-positive` instead. Wontfix tanks strict score. This has been violated multiple times — DO NOT repeat.

```bash
# CORRECT — false positive or not-worth-it:
desloppify plan skip --false-positive "<id>" --attest "..."

# WRONG — this is wontfix and penalizes strict score:
desloppify plan skip --permanent "<id>" --note "..." --attest "..."
```

**For recurring false positives** (reopened 3+ times), use `suppress` to stop the reopen cycle. `skip --false-positive` is plan-level only — the scanner re-detects and reopens on every rescan. `suppress` is detector-level and prevents re-detection entirely.

```bash
# Stop a false positive from ever being re-flagged:
desloppify suppress "<id>" --attest "I have actually verified <why it's false> and I am not gaming the score"
```

Only use `--permanent` for genuine issues deliberately accepted as technical debt.

## Reviews

When running blind subjective reviews (subagent reviewers), ALWAYS instruct them to follow SOLID principles and composition over inheritance:

- **Dependency Inversion**: Single-impl interfaces for DI/testability are CORRECT — do NOT penalize them
- **Composition over Inheritance**: Strategy pattern, delegation, interface-based injection are BETTER than inlining or using concrete classes directly — do NOT suggest removing interfaces in favor of jest.spyOn or coupling to implementations
- **Interface Segregation**: Focused interfaces are good even if there's one implementation
- **Named type aliases** add semantic clarity at zero cost — do NOT penalize them
- **Do NOT encourage inheritance** by suggesting inlining composed strategies or removing abstraction layers that enable DI

## Subagent Rate Limits

**NEVER launch more than 3 subagents at a time.** Launching 20 parallel review agents burned the user's entire 5-hour token budget in minutes. Follow this process:

1. Launch 2-3 subagents max in the first batch
1. Wait for them to complete and verify they produced valid output
1. Only then launch the next batch of 2-3
1. Continue until all batches are done

This applies to ALL subagent work, not just desloppify reviews.
