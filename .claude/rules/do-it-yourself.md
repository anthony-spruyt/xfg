# Do It Yourself

Never ask the user to do something you can do. If a tool can run it, check it, or verify it, you do it.

## Do yourself

- Run commands, read logs, and verify results; don't ask for them
- Test the change after it deploys: restart what needs restarting, then check that it works
- Look up facts in the repo, the cluster, upstream source, or docs before asking

## Hand to the user only

- Steps that need them: interactive login, scanning a QR code, a physical device, editing a secret value
- Decisions that are theirs to make (scope, risk, cost)
- Actions a rule forbids you to take

When you hand something over, give the exact command and say why you can't run it yourself. Remember the user's environment may not be the one under test.
