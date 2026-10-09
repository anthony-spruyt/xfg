# Changelog

## [8.1.2](https://github.com/anthony-spruyt/xfg/compare/v8.1.1...v8.1.2) (2026-10-09)


### Bug Fixes

* **config:** strip and validate merge directives on content with no overlay ([#1164](https://github.com/anthony-spruyt/xfg/issues/1164)) ([bcc94c3](https://github.com/anthony-spruyt/xfg/commit/bcc94c346b4bc76839bcb9723597189e92eb01ed))


### Dependencies

* **deps:** update dependency @types/node to v24.19.1 ([#1153](https://github.com/anthony-spruyt/xfg/issues/1153)) ([fe3a7b5](https://github.com/anthony-spruyt/xfg/commit/fe3a7b54f30a21ffa2e582caf697a4079f307460))

## [8.1.1](https://github.com/anthony-spruyt/xfg/compare/v8.1.0...v8.1.1) (2026-10-09)


### Bug Fixes

* **lifecycle:** let App tokens create repos on personal accounts ([#1151](https://github.com/anthony-spruyt/xfg/issues/1151)) ([3e4df01](https://github.com/anthony-spruyt/xfg/commit/3e4df0167d3b9f0fbff26d47b56133516f377adf))


### Continuous Integration

* run xfg's repo jobs from ci-repo.yaml ([#1143](https://github.com/anthony-spruyt/xfg/issues/1143)) ([81019f4](https://github.com/anthony-spruyt/xfg/commit/81019f4828c12523cba3554efcbbcadfbe91229d))

## [8.1.0](https://github.com/anthony-spruyt/xfg/compare/v8.0.0...v8.1.0) (2026-10-08)


### Features

* manage GitHub repository environments ([#1139](https://github.com/anthony-spruyt/xfg/issues/1139)) ([ed52de4](https://github.com/anthony-spruyt/xfg/commit/ed52de48348a5cad8a78aeee03d7daa54bb762d2))
* match array items by a chosen key when merging ([#1140](https://github.com/anthony-spruyt/xfg/issues/1140)) ([d978699](https://github.com/anthony-spruyt/xfg/commit/d97869941c42c38c9faad9aee692c91cc8a28c80))

## [8.0.0](https://github.com/anthony-spruyt/xfg/compare/v7.5.2...v8.0.0) (2026-10-07)


### ⚠ BREAKING CHANGES

* GitHub Enterprise Server users must set XFG_ALLOWED_GITHUB_HOSTS (or allowed-github-hosts in the action) or xfg runs without a token for those hosts. Configs that interpolate GH_TOKEN, GITHUB_TOKEN, XFG_GITHUB_APP_PRIVATE_KEY and similar credential names now fail validation.

### Bug Fixes

* harden GitHub credential hosts, interpolation and repo writes ([#1124](https://github.com/anthony-spruyt/xfg/issues/1124)) ([7b5f4e7](https://github.com/anthony-spruyt/xfg/commit/7b5f4e70cd125e3d522685c5a9e2f4ecd8665d5e))
* **sync:** sort render.json entries with an explicit comparator ([#1131](https://github.com/anthony-spruyt/xfg/issues/1131)) ([6482f70](https://github.com/anthony-spruyt/xfg/commit/6482f70a6325305050514779a90224ae0a822197))


### Performance Improvements

* **ci:** speed up integration tests ([#1119](https://github.com/anthony-spruyt/xfg/issues/1119)) ([375d479](https://github.com/anthony-spruyt/xfg/commit/375d47992511f7d224c80abca1e0bf4c9c7d4bd4))

## [7.5.2](https://github.com/anthony-spruyt/xfg/compare/v7.5.1...v7.5.2) (2026-10-07)


### Bug Fixes

* **test:** stop matching 429 inside repo names as a rate limit ([#1108](https://github.com/anthony-spruyt/xfg/issues/1108)) ([6c6916c](https://github.com/anthony-spruyt/xfg/commit/6c6916c44111b6fdf8a854b069995ea2a46e861c))


### Continuous Integration

* gate ADO and GitLab credentials behind the integration environments ([#1107](https://github.com/anthony-spruyt/xfg/issues/1107)) ([4485bca](https://github.com/anthony-spruyt/xfg/commit/4485bcace36f5fba84c27fcdb56bfdf894d04dd6))

## [7.5.1](https://github.com/anthony-spruyt/xfg/compare/v7.5.0...v7.5.1) (2026-10-07)


### Continuous Integration

* gate integration-test secrets behind environments and lint pushes to main ([#1099](https://github.com/anthony-spruyt/xfg/issues/1099)) ([283b7c2](https://github.com/anthony-spruyt/xfg/commit/283b7c2a047d2b06cb5f8b30c0f1e984a81a1fe4))
* pass environment secrets to the integration workflow by name ([#1104](https://github.com/anthony-spruyt/xfg/issues/1104)) ([5806c6c](https://github.com/anthony-spruyt/xfg/commit/5806c6c06d1d4e47219f8558a03d0ad3da95e317)), closes [#1093](https://github.com/anthony-spruyt/xfg/issues/1093)

## [7.5.0](https://github.com/anthony-spruyt/xfg/compare/v7.4.0...v7.5.0) (2026-10-06)


### Features

* **sync:** add --render-dir to write dry-run file changes to disk ([#1090](https://github.com/anthony-spruyt/xfg/issues/1090)) ([0ab708a](https://github.com/anthony-spruyt/xfg/commit/0ab708a360cef79623a40dfbeb16a412dacb04d9))


### Dependencies

* **deps:** update dependency @types/node to v24.19.0 ([#1078](https://github.com/anthony-spruyt/xfg/issues/1078)) ([c60fd80](https://github.com/anthony-spruyt/xfg/commit/c60fd808087dc349b8d5b215a4515cfa832c23ec))
* **deps:** update dependency chalk to v6.0.1 ([#1083](https://github.com/anthony-spruyt/xfg/issues/1083)) ([af526b1](https://github.com/anthony-spruyt/xfg/commit/af526b15fb2877a229ecc37de6e08fead08d66f7))

## [7.4.0](https://github.com/anthony-spruyt/xfg/compare/v7.3.0...v7.4.0) (2026-10-02)


### Features

* **settings:** manage collaborators on personal repos ([#1074](https://github.com/anthony-spruyt/xfg/issues/1074)) ([0139dca](https://github.com/anthony-spruyt/xfg/commit/0139dca6a43fb590dfc846e55e0474ec595715f6))


### Bug Fixes

* **lifecycle:** fail fast when App token targets a personal account ([#1071](https://github.com/anthony-spruyt/xfg/issues/1071)) ([17bf24a](https://github.com/anthony-spruyt/xfg/commit/17bf24a4d16dbea51e1fbf26638b9377f1a5669d))

## [7.3.0](https://github.com/anthony-spruyt/xfg/compare/v7.2.1...v7.3.0) (2026-09-30)


### Features

* AI-generated conventional commit messages and PR descriptions ([#1055](https://github.com/anthony-spruyt/xfg/issues/1055)) ([89ec502](https://github.com/anthony-spruyt/xfg/commit/89ec5021def0c9cbc8e279567734c894b4f8b109))


### Bug Fixes

* **output:** stop code fences in diffs from breaking the step summary ([#1043](https://github.com/anthony-spruyt/xfg/issues/1043)) ([78f27e4](https://github.com/anthony-spruyt/xfg/commit/78f27e4e673ac30c0aca034e8c221f5f1e8ef191))

## [7.2.1](https://github.com/anthony-spruyt/xfg/compare/v7.2.0...v7.2.1) (2026-09-28)


### Dependencies

* **deps:** update dependency tsx to v4.23.15 ([#1036](https://github.com/anthony-spruyt/xfg/issues/1036)) ([196e8df](https://github.com/anthony-spruyt/xfg/commit/196e8dfe44ab65fc67648497a92176e6e0dfd2be))

## [7.2.0](https://github.com/anthony-spruyt/xfg/compare/v7.1.0...v7.2.0) (2026-09-26)


### Features

* **secrets:** GitHub App auth for secrets sync and action support ([#1028](https://github.com/anthony-spruyt/xfg/issues/1028)) ([7192a75](https://github.com/anthony-spruyt/xfg/commit/7192a751bc8cbb32de13a0136eb2b7f3a0512bc4))
* **secrets:** list secret names per repo in secrets sync output ([#1029](https://github.com/anthony-spruyt/xfg/issues/1029)) ([b9bd38d](https://github.com/anthony-spruyt/xfg/commit/b9bd38de9466c7a7aa1113526a783bd166e0e57f))


### Documentation

* remove duplicated sources of truth ([#1023](https://github.com/anthony-spruyt/xfg/issues/1023)) ([9f2f0b8](https://github.com/anthony-spruyt/xfg/commit/9f2f0b832432d6d04cb460d59099977ba79fa3f5))

## [7.1.0](https://github.com/anthony-spruyt/xfg/compare/v7.0.0...v7.1.0) (2026-09-22)


### Features

* **rulesets:** support bypassMode: exempt ([#1020](https://github.com/anthony-spruyt/xfg/issues/1020)) ([5e7299e](https://github.com/anthony-spruyt/xfg/commit/5e7299e9f3e9c6846809041dfbfbd7b50355d114)), closes [#1019](https://github.com/anthony-spruyt/xfg/issues/1019)

## [7.0.0](https://github.com/anthony-spruyt/xfg/compare/v6.4.7...v7.0.0) (2026-09-21)


### ⚠ BREAKING CHANGES

* root-level 'secrets:' is no longer supported. Move it under 'settings.secrets', where it can also be scoped per group and per repo. See docs/migration-v7.md.

### Features

* scope secrets by group and repo ([#1010](https://github.com/anthony-spruyt/xfg/issues/1010)) ([7605a01](https://github.com/anthony-spruyt/xfg/commit/7605a01d23373d4ba91215a333d1a1abc2170533))


### Bug Fixes

* **lint:** resolve eslint flat config under MegaLinter ([#1002](https://github.com/anthony-spruyt/xfg/issues/1002)) ([e0f8126](https://github.com/anthony-spruyt/xfg/commit/e0f8126217ac61c0c39e695e8a3353dcffa84a66))


### Dependencies

* **deps:** update dependency @types/node to v24.13.6 ([#997](https://github.com/anthony-spruyt/xfg/issues/997)) ([3e7d376](https://github.com/anthony-spruyt/xfg/commit/3e7d376fe4f8c25fd14c90e531e50e29b544622a))

## [6.4.7](https://github.com/anthony-spruyt/xfg/compare/v6.4.6...v6.4.7) (2026-09-19)


### Dependencies

* **deps:** update dependency @types/node to v24.13.4 ([#984](https://github.com/anthony-spruyt/xfg/issues/984)) ([689c792](https://github.com/anthony-spruyt/xfg/commit/689c79243243c2ff3b89ea4c721a2c632482541d))
* **deps:** update dependency yaml to v2.9.1 ([#990](https://github.com/anthony-spruyt/xfg/issues/990)) ([cb07c8b](https://github.com/anthony-spruyt/xfg/commit/cb07c8bc715605b3ff86feb2e157846a44d3029c))

## [6.4.6](https://github.com/anthony-spruyt/xfg/compare/v6.4.5...v6.4.6) (2026-09-16)


### Dependencies

* move build inputs under packages/xfg ([#980](https://github.com/anthony-spruyt/xfg/issues/980)) ([aff36a2](https://github.com/anthony-spruyt/xfg/commit/aff36a26a42ffeac66bfdb6d0eca8bad7210128d))

## [6.4.5](https://github.com/anthony-spruyt/xfg/compare/v6.4.4...v6.4.5) (2026-09-16)


### Bug Fixes

* **release:** trigger publish from the tag instead of release-please output ([#978](https://github.com/anthony-spruyt/xfg/issues/978)) ([4f1803f](https://github.com/anthony-spruyt/xfg/commit/4f1803f60fd603e23f035fae01c47b06336bb006))

## [6.4.4](https://github.com/anthony-spruyt/xfg/compare/v6.4.3...v6.4.4) (2026-09-15)


### Bug Fixes

* **lint:** pin MegaLinter image to a tag and digest ([#969](https://github.com/anthony-spruyt/xfg/issues/969)) ([2259c3e](https://github.com/anthony-spruyt/xfg/commit/2259c3edfa1c479d52d0e16a3d76d87f75eed86e))


### Dependencies

* **deps:** update dependency p-retry to v8.0.1 ([#966](https://github.com/anthony-spruyt/xfg/issues/966)) ([b8bf7ef](https://github.com/anthony-spruyt/xfg/commit/b8bf7eff130e8f70716f7f6b7863f822f459f833))
* **deps:** update dependency tsx to v4.23.11 ([#952](https://github.com/anthony-spruyt/xfg/issues/952)) ([e3e4aa8](https://github.com/anthony-spruyt/xfg/commit/e3e4aa8abd17ab9509c52bc3e935e5e9a9983180))
* **deps:** update dependency tsx to v4.23.12 ([#955](https://github.com/anthony-spruyt/xfg/issues/955)) ([688b858](https://github.com/anthony-spruyt/xfg/commit/688b8580f768c37ae7266150dd9b2234467f350d))
* **deps:** update dependency tsx to v4.23.13 ([#963](https://github.com/anthony-spruyt/xfg/issues/963)) ([23fcb22](https://github.com/anthony-spruyt/xfg/commit/23fcb22048168b20049a41dd3758e9002f9aebdc))
* **deps:** update dependency tsx to v4.23.5 ([#943](https://github.com/anthony-spruyt/xfg/issues/943)) ([50f526e](https://github.com/anthony-spruyt/xfg/commit/50f526ee70fe4efdb10a3151f0302a1961388dd5))
* sync .devcontainer/devcontainer.json, .claude/rules/research.md, .mergify.yml ([6d25f00](https://github.com/anthony-spruyt/xfg/commit/6d25f00f6414f4b9f97160370ae105bb9b156b36))
* sync .markdownlint.json ([2c9961f](https://github.com/anthony-spruyt/xfg/commit/2c9961f271725d49ac7de3c4bc1f55585d4a01bc))
* sync .mcp.json ([8ad63ed](https://github.com/anthony-spruyt/xfg/commit/8ad63edd6cd7a12af96632886d41c8a066a41167))
* sync .mergify.yml ([852625f](https://github.com/anthony-spruyt/xfg/commit/852625fc40c3dce38179faff12ca40fd2c54f00d))
* sync .mergify.yml ([cd1c57a](https://github.com/anthony-spruyt/xfg/commit/cd1c57a4802d189c968572b04c446591792fe9ee))
* sync .mergify.yml ([751c45d](https://github.com/anthony-spruyt/xfg/commit/751c45dc649892659b4bdf80b1ed085693a0b7a9))
* sync .mergify.yml ([bd265d8](https://github.com/anthony-spruyt/xfg/commit/bd265d8940d78e95be253438293ba92867765742))
* sync .mergify.yml ([6fd0f01](https://github.com/anthony-spruyt/xfg/commit/6fd0f011d811b9252c8df7b6b5be3f8769177848))
* sync .sonarcloud.properties ([0cbf1bd](https://github.com/anthony-spruyt/xfg/commit/0cbf1bd2f88ebdbb271b6d92ce8a02482950f2d9))
* sync .sonarcloud.properties, .xfg.json ([1caeb7a](https://github.com/anthony-spruyt/xfg/commit/1caeb7ab3102dccd70369ee3534741a6dd2ab12e))
* sync 4 config files ([4310ba1](https://github.com/anthony-spruyt/xfg/commit/4310ba17286d6bb10311ab511b5df18e08548917))


### Continuous Integration

* move releases to release-please ([#971](https://github.com/anthony-spruyt/xfg/issues/971)) ([d8a167a](https://github.com/anthony-spruyt/xfg/commit/d8a167afb882e99fbe3e2fa44626daea2d6fa079))
