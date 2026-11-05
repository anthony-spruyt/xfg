# Public Repos

This repo and its GitHub issues, PRs and comments are public: anyone can read and index them. The only private place for security notes is the `anthony-spruyt/security` repo.

## Never write in public

- Known gaps, unfixed weaknesses, or what a control does not cover
- Attack paths, bypass steps, exploit recipes
- What a credential, token or service account can reach
- Risk ratings, "accepted risk", "residual risk", "fails open"

This covers issues, PRs, comments, commit messages, READMEs, docs, code comments and `.claude/` files.

## Instead

- Track security work and findings as issues in `anthony-spruyt/security`
- Nothing public (commits, PRs, issues, comments) names the security repo; commits and PRs reference the neutral public issue
- The security issue links its public issue by full name (`anthony-spruyt/<repo>#123`): a bare `#123` links the security repo's own issue and `<repo>#123` links nothing. GitHub shows the backlink only to people who can read the security repo
- Before closing an issue, find its security issue with `gh search issues --repo anthony-spruyt/security "<owner>/<repo>#<n>"` and close both in the same step
- Report security findings to whoever asked: a subagent to the agent that called it, the main session to the owner
- In public text, describe controls as the end state: "Only the API gateway can reach this service"
- In public commit and PR titles, word security work as a neutral task: "Restrict admin paths to the LAN"
- Post other reports as usual, with security findings removed
