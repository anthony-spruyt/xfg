# Progress Notes

Compaction loses detail, so keep the state of multi-step work on disk, as in Anthropic's [long-running agent harness](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents). A fresh session catches up from the notes and `git log`.

## When

Any task with more than one step, or that may outlive this session. Skip one-shot edits and questions.

## Where

`.agent-progress/<branch>.md` at the root of the checkout you are working in, with each `/` in the branch name replaced by `-`. In a worktree that is the worktree's root, not the main checkout. The folder is gitignored and stays on this machine. A SessionStart hook loads the current branch's file on startup, `/clear` and compaction.

The issue body stays the public plan and checklist; the progress file is your working memory.

## What

Under 100 lines; the hook loads only the first 9,000 characters. Write for a reader with no memory of this session:

- Goal and issue number
- Done, with commit SHAs
- The exact next step
- Decisions and why
- Dead ends, so they are not retried
- Commands and gotchas that matter

## How

1. **Start**: read the notes and `git log --oneline -10` before anything else. When they disagree, git wins.
2. **One step at a time**: finish it, test it, commit it, then update the notes.
3. **Before you stop**: update the notes so the next session can start without asking.
4. **Done**: delete the file when the task is finished or the branch merges, so a later session on the same branch does not load stale notes.
