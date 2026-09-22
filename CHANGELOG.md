# Changelog

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
