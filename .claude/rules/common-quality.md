# Code Quality

## Always Choose the Proper Fix

When two options exist — a hack/shortcut and a proper fix — **always choose the proper fix**. No exceptions.

Examples:
- Don't cast to `unknown` or `any` to work around a type mismatch — fix the types properly
- Don't use inline suppressions (`eslint-disable`, `@ts-ignore`) — fix the underlying issue
- Don't widen a parameter type to paper over a design problem — restructure the code
- Don't add backwards-compat shims — change the callers
