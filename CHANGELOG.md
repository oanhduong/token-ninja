# Changelog

All notable changes to this project are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [SemVer](https://semver.org/).

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
