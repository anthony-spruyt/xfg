# Workflow Completion

## Commit and Push Automatically

When you complete code changes and verification passes (build/test/lint), **commit and push immediately without asking**. This is not optional. Do not:

- Ask "want me to commit?"
- Ask "should I push?"
- Say "want me to commit and push?"
- Wait for explicit instruction to commit
- Wait for explicit instruction to push

The workflow is: fix → verify → commit → push → report done. All one motion.

**Only pause for confirmation on:**

- Force push
- Destructive git operations

Feature branch commit+push after green CI is NEVER a confirmation-worthy action.
