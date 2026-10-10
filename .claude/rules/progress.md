# Progress Notes

Compaction loses detail, so keep the state of multi-step work on disk, as in Anthropic's [long-running agent harness](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents). A session that resumes or compacts gets its notes reloaded; `git log` stays the source of truth.

## When

Any task with more than one step, or that may outlive this session. Skip one-shot edits and questions.

## Where

`.agent-progress/<session_id>.md` in the checkout you work in (the worktree root, in a git worktree). A SessionStart hook prints the exact path when the session starts in a git checkout, so use that path; sessions sharing a checkout or branch each get their own file. The folder is gitignored and stays on this machine.

The hook loads the file again after compaction and `--resume`, which keep the same session ID. If the session has moved to another checkout, the hook loads the file from the checkout it started in and prints both paths. `/clear`, a fork and a new session get a new ID and so a new, empty file. A new session or fork finds earlier notes by hand: run `ls -t` on the folder in the path the hook printed and pick the file whose goal matches your task (the newest alone is not enough when several agents share a checkout). Ignore any file git tracks there (`git ls-files .agent-progress`). Copy what you need into your own file. Subagents get no path and keep no notes file.

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

1. **Start**: read the notes if the hook loaded any, and `git log --oneline -10`, before anything else. When they disagree, git wins.
2. **One step at a time**: finish it, test it, commit it, then update the notes.
3. **Before you stop**: update the notes so a resumed or compacted session reloads them, and a new session finds them as described under Where.
4. **Done**: delete your file when the task is finished, so a later session does not pick up stale notes.
