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
- Public commits and PRs reference a neutral public issue, never the security repo
- Report security findings to whoever asked: a subagent to the agent that called it, the main session to the owner
- In public text, describe controls as the end state: "Only the API gateway can reach this service"
- In public commit and PR titles, word security work as a neutral task: "Restrict admin paths to the LAN"
- Post other reports as usual, with security findings removed
