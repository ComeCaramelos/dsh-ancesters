# AGENTS.md

Shared base layer for the dsh plugins (`dsh-mcp-manager`, `dsh-chrome-mcp`,
`dsh-docker-desktop-mcp`). Not a plugin: no bundle, no `cordis.patch.yml`.

## Rules

- Everything that touches a dsh 0.2 surface lives here and is tested here
  (`test/*.test.mjs`); consumers never re-implement it. A capability enters through a
  typed hole (props, callbacks, hooks), never through a flat `config`, and a consumer's
  odd logic stays in the consumer.
- Feature-detect dsh surfaces by shape; never compare version strings. A missing surface
  fails loudly once (`this dsh build is not supported`).
- Two planes: `src/host/**` (Node, `tsc` → `lib/host/*`) and `src/client/**` (browser,
  bundled). Consumers alias `@comecaramelos/dsh-ancesters/client` to `client/source`
  (ESM) in their own client bundle. `lib/` is generated — never edit it.
- Locale dictionaries register under `en` / `zh` only.
- A change here must keep the three consumers' suites green on WSL and on Windows.
- Start dsh with `--no-open`; on Windows never run `chrome.exe --version` (it opens a
  browser window).
- Docs: `README.md` is for people and short; longer topics go to `docs/knowledge/*.md`,
  linked from the README; agent-only rules go here. `docs/spec/` and `docs/plans/` are
  local (ignored) — nothing versioned links to them.
- Git: never push; only finished work is committed, squashed into the branch's commit.
