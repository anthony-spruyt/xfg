# Red-Green TDD

When writing tests and implementing features, follow the red-green-refactor cycle:

| Phase        | Action                                   |
| ------------ | ---------------------------------------- |
| **Red**      | Write a failing test first               |
| **Green**    | Write minimal code to make the test pass |
| **Refactor** | Clean up code while keeping tests green  |

## Workflow

1. **Red** - Write a test that fails (or doesn't compile)
   - Define the expected behavior before implementation
   - Run the test to confirm it fails

2. **Green** - Make it pass with minimal code
   - Write just enough code to pass the test
   - Avoid over-engineering or adding untested features

3. **Refactor** - Improve the code
   - Clean up duplication, naming, structure
   - Run tests after each change to ensure they still pass

## Key Principles

- Never write production code without a failing test
- One test at a time - don't batch multiple behaviors
- If tests pass and you haven't written test code, you're skipping the red phase
