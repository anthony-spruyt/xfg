# Red-Green TDD

When writing tests and implementing features, follow the red-green-refactor cycle, one behavior at a time:

1. **Red** - Write a test that defines the expected behavior, run it, and confirm it fails (or doesn't compile).
2. **Green** - Write just enough code to make it pass; add no untested features.
3. **Refactor** - Clean up duplication, naming, and structure, re-running the tests after each change.

This applies to code that has a test runner. Declarative config with no test harness (manifests, plain Terraform) is exempt; its linters and validators cover it.

Never write production code without a failing test. If tests pass and you haven't written test code, you skipped the red phase.
