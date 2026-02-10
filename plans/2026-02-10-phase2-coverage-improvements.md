# Phase 2: Code Coverage Improvements

## Overview

After Phase 1 merges, identify and fix coverage gaps to meet 95% threshold.

## Prerequisites

- Phase 1 PR merged
- Main branch updated with new structure

## Approach

1. Run `npm run test:coverage` to get baseline
2. Review coverage report for files below 95%
3. Write targeted tests for uncovered code paths
4. Iterate until 95% threshold met

## Likely Coverage Gaps

Based on refactoring patterns, these areas may need attention:

### Error Handling Paths

- Exception handling in strategies
- Edge cases in selectors/factories
- Network error scenarios

### New/Modified Files

- Any logic moved during refactoring
- Factory functions in index files (if not properly excluded)
- Type guards (e.g., `isRepoSettingsStrategy`)

### Platform-Specific Code

- Azure DevOps PR strategy edge cases
- GitLab PR strategy edge cases
- GraphQL commit strategy error paths

## Implementation Steps

1. [ ] Checkout main after Phase 1 merge
2. [ ] Create branch for coverage improvements
3. [ ] Run `npm run test:coverage`
4. [ ] List files below 95% coverage
5. [ ] For each file, identify uncovered lines
6. [ ] Write tests for uncovered paths
7. [ ] Re-run coverage to verify improvement
8. [ ] Repeat until all files meet threshold
9. [ ] Run full test suite
10. [ ] Create PR

## Validation

- [ ] `npm run test:coverage` passes (95% threshold)
- [ ] `npm test` passes
- [ ] `./lint.sh` passes
- [ ] No regressions in existing tests

## Notes

- Focus on meaningful coverage, not just hitting lines
- Test error paths and edge cases, not just happy paths
- Avoid testing trivial code (getters, simple pass-through)
- Coverage configs should exclude type-only and re-export files
