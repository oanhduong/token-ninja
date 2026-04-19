# Changelog

All notable changes to this project are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [SemVer](https://semver.org/).

## [0.3.0](https://github.com/oanhduong/token-ninja/compare/v0.2.0...v0.3.0) (2026-04-19)


### Features

* **hook:** replace PreToolUse Bash hook with UserPromptSubmit — real token savings ([89394ec](https://github.com/oanhduong/token-ninja/commit/89394ec5e40ea8dff7cffecf99ba1822d40b19e2))
* **setup:** auto-register ninja mcp with Gemini CLI ([6932f36](https://github.com/oanhduong/token-ninja/commit/6932f36d1cce55cbd4e3411fba4c665bb39cfc12))


### Bug Fixes

* **router:** preserve ANSI colors when the hook short-circuits the model ([1b323b2](https://github.com/oanhduong/token-ninja/commit/1b323b2de91920d366c1e74d31af9ee0da680ceb))

## [0.2.0](https://github.com/oanhduong/token-ninja/compare/v0.1.0...v0.2.0) (2026-04-19)


### Features

* **adapters:** AI tool adapters and shell shim generator ([9ad4170](https://github.com/oanhduong/token-ninja/commit/9ad4170354a4eb46e5ce5b937f453da41d5374f4))
* **cli:** commander entry point with mcp/init/stats/shim/rules subcommands ([ab1d87f](https://github.com/oanhduong/token-ninja/commit/ab1d87f7e06212236730a52fb154c6e2ad17b9c4))
* **mcp:** stdio server exposing maybe_execute_locally ([e0aeb4b](https://github.com/oanhduong/token-ninja/commit/e0aeb4b5d87d2734ce00f36de92032617bf44ddd))
* **router:** classifier with exact/prefix/regex/nl matching ([a42ac80](https://github.com/oanhduong/token-ninja/commit/a42ac8078ce42f4921dacc5a3459a6d053a6c572))
* **router:** runRouter orchestrator ([02db87f](https://github.com/oanhduong/token-ninja/commit/02db87ff44ad41e1c50005c2914179cd472b9e33))
* **router:** shell executor and AI fallback ([748f4b0](https://github.com/oanhduong/token-ninja/commit/748f4b07f4d1ecfb9fa287a51bcc9be0bfa23006))
* **rules:** build/test/lint/editor/db/nl-mappings (70 rules) ([ec476a3](https://github.com/oanhduong/token-ninja/commit/ec476a32c5dc157031816398049f40c7b2cf7d3f))
* **rules:** docker and kubernetes rules (38 rules) ([69f3e77](https://github.com/oanhduong/token-ninja/commit/69f3e77dd7c04556ae5f2da723a5c671444a1093))
* **rules:** expand coverage with 10 new domains; clarify interactive session usage ([48f6643](https://github.com/oanhduong/token-ninja/commit/48f66437cd35b2c7cf78491e214c9efca4d77f86))
* **rules:** git and github-cli rules (75 rules) ([547fd56](https://github.com/oanhduong/token-ninja/commit/547fd56d174f3f186302b5caae01ac6dc582604b))
* **rules:** language ecosystems (python/ruby/php/rust/go/java/kotlin, 87 rules) ([f6070f7](https://github.com/oanhduong/token-ninja/commit/f6070f7f994e5a1717f747e4ccf318f9016ed7fb))
* **rules:** node ecosystem (npm/pnpm/yarn/bun, 60 rules) ([05432dd](https://github.com/oanhduong/token-ninja/commit/05432dd5cfd1a028389fe34617675e115d1ddba1))
* **rules:** Rule types and YAML loader ([73765a2](https://github.com/oanhduong/token-ninja/commit/73765a28880e8a1eb74006695505abd667d62dfb))
* **rules:** shell/filesystem/network/system (142 rules) ([369b234](https://github.com/oanhduong/token-ninja/commit/369b23489815c952e5da816d8684f22643b9717d))
* **safety:** deny-list and validator with NFKC + homoglyph normalization ([d939cfc](https://github.com/oanhduong/token-ninja/commit/d939cfc51e57b7afb6ae2d0389ba8c3a88443821))
* **setup:** auto-install shell shims on `npm i -g`; show per-run savings ([ce8812e](https://github.com/oanhduong/token-ninja/commit/ce8812eec24a1e6676316d6b3892b622a774b132))
* **setup:** auto-register ninja mcp with Claude Code / Cursor / Claude Desktop ([ab36755](https://github.com/oanhduong/token-ninja/commit/ab367550ee7760cabd986aea09a31df68c69d091))
* **setup:** intercept Claude Code Bash tool via PreToolUse hook ([644a33a](https://github.com/oanhduong/token-ninja/commit/644a33a328de7a4dd3486486c0ef91116022fed5))
* **setup:** intercept Claude Code Bash tool via PreToolUse hook ([5a1ba51](https://github.com/oanhduong/token-ninja/commit/5a1ba514d6b6702e3f077a9685c03a79cd28bbda))
* user config and telemetry stats ([d933ed9](https://github.com/oanhduong/token-ninja/commit/d933ed9f16a71e84c08dc746956f307095d90c15))
* **utils:** shell parser, repo detector, stderr logger ([5353ac8](https://github.com/oanhduong/token-ninja/commit/5353ac8d0d608fbbbc64c80e4821fe039486b5cf))


### Bug Fixes

* **ci:** bump bench factor to 25x and add SKIP_BENCH opt-out ([973167c](https://github.com/oanhduong/token-ninja/commit/973167c291c05f7580b62ccd40cd357901b1922e))
* **ci:** don't mistake shell builtin `continue` for the Continue CLI; realpath /tmp in executor test ([1174292](https://github.com/oanhduong/token-ninja/commit/117429216f17bb0df409d4cb75d552bc21a1b33a))
* **test:** scale benchmark thresholds on CI (10x) via BENCH_FACTOR ([892539e](https://github.com/oanhduong/token-ninja/commit/892539ea2866974250ab58f001a43ee62cd10656))


### Documentation

* CLAUDE.md with repo invariants for AI assistants ([b2d6c91](https://github.com/oanhduong/token-ninja/commit/b2d6c9186236acb2d87aa246f2629d67f0d480a9))
* OSS governance (CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, CHANGELOG) ([b0716e8](https://github.com/oanhduong/token-ninja/commit/b0716e8ed63defc9f071babf6524c4c7ad6ffe48))
* README with install, quickstart, rule format, and safety model ([ead3683](https://github.com/oanhduong/token-ninja/commit/ead3683fa97c113ad4edfd5c5d0da565d1728c57))
* **readme:** add npm weekly downloads badge ([0337e67](https://github.com/oanhduong/token-ninja/commit/0337e6761eda87a651c3f9b5a39a140c1eb1ea42))
* **readme:** add npm weekly downloads badge ([bbb7c5b](https://github.com/oanhduong/token-ninja/commit/bbb7c5b34597ab039114628675a609bc085f862c))
* **readme:** professional overhaul — badges, guide, test report ([973167c](https://github.com/oanhduong/token-ninja/commit/973167c291c05f7580b62ccd40cd357901b1922e))
* **readme:** reframe around in-session usage; drop one-shot examples ([6e92bde](https://github.com/oanhduong/token-ninja/commit/6e92bdeda3b444b00e75fef1a0ecc7801d354470))
* **readme:** rewrite in awesome-template style ([6a86451](https://github.com/oanhduong/token-ninja/commit/6a86451a58add3d2c401017e1bdf68cde3f13e05))

## [Unreleased]

## [0.1.0] - initial public release

### Added
- 472 built-in rules across 29 tool domains (git, npm, pnpm, yarn, bun,
  python, ruby, php, rust, go, java, kotlin, docker, kubernetes, database,
  network, filesystem, …).
- Classifier with exact → prefix → regex → natural-language matching, with
  longest-prefix-wins semantics and template expansion.
- Safety validator with a hard deny-list (rm -rf, sudo, curl|sh,
  git push --force, DROP TABLE, docker system prune -af, …) plus
  pipeline-split, NFKC, and homoglyph normalization.
- MCP stdio server exposing `maybe_execute_locally`.
- `ninja shim <tool>` generates a shell function that routes `claude`/
  `codex`/`cursor-agent`/`aider`/`gemini`/`continue` through the router.
- `ninja stats` tracks cumulative token-saving estimates.
- User rules from `~/.config/token-ninja/rules/*.yaml` (loaded after
  builtins; duplicate id wins).
- 195+ tests, 89 %+ line coverage on the router/safety/rules hot path,
  ~37µs classifier and ~4µs validator benchmarks.

[Unreleased]: https://github.com/token-ninja/token-ninja/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/token-ninja/token-ninja/releases/tag/v0.1.0
