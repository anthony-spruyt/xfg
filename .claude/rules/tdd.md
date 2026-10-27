# Red-Green TDD

When writing tests and implementing features, follow the red-green-refactor cycle, one behavior at a time:

1. **Red** - Write a test that defines the expected behavior, run it, and confirm it fails (or doesn't compile).
2. **Green** - Write just enough code to make it pass; add no untested features.
3. **Refactor** - Clean up duplication, naming, and structure, re-running the tests after each change.

This applies to code that has a test runner. Declarative config with no test harness (manifests, plain Terraform) is exempt; its linters and validators cover it. Values with no behavior of their own need no test even where a runner exists: a version, a name, a description. Don't repeat a check a linter or schema already runs.

Outside these exemptions, never write production code without a failing test. If tests pass and you haven't written test code, you skipped the red phase.

## What a test checks

Before writing a test, name the bug it catches. "Someone changed this line on purpose" is not a bug: skip that test.

- Test behavior, or an invariant that hurts when broken (a token's scope, a job's order, two pins that must match), not the file's current text.
- Never assert a value a bot updates (versions, digests, action SHAs and their tag comments). Check its shape, or compare it to the pin it must equal.
- Assert only the fields the invariant needs, not a copy of the whole config block.
- Prove the test can catch its bug: break the code, not the test, watch it fail, then restore the code.
