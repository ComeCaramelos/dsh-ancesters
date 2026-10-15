# Changelog

All notable changes to `@comecaramelos/dsh-ancesters` are documented here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the
project follows semver and the compat rule: a dsh range change moves the minor.

## Unreleased

### Added

- **The user layer on the card snapshot**: `CardSnapshot.overridden` lists the
  fields the served form's `user` layer carries (what an Overridden badge is
  drawn from), and `CardController.resetField(field)` returns one field to the
  row's own answer with an `unset` through the write door, dropping any draft
  over it. Both are additive; `dsh-hover-information` is the first consumer.
- **`placement: "bundle"`** on `mountSettingsCard`: the card registers into
  `plugins.bundle.config`, keyed by the bundle package name, so it stands on the
  bundle page the Plugins list opens instead of one step further in, on the
  row's own page. `"row"` stays the default.

### Changed

- **stderr routing without a shell** (breaking): `buildSpawn` in `"log"` mode
  now answers `<process.execPath> <STDERR_WRAPPER_PATH> <logPath> <serverName>
  <command> <args…>` on Linux, WSL and Windows alike. The wrapper
  (`lib/host/stderr-wrapper.js`, exported path `STDERR_WRAPPER_PATH`) spawns
  the argv verbatim through `cross-spawn` with stdin/stdout inherited and only
  stderr to the log, forwards SIGTERM/SIGINT/SIGHUP, re-raises a child's
  signal, exits 127 with the reason on the console when the executable is
  missing, and falls back to the console with one line when the log cannot
  open. The `sh -c` script is gone, and with it `SpawnResult.fallback` and the
  `platform`/`exists` options; `StderrOptions` gains `execPath`.
- **`engines.dsh: "^0.2.0-0"`** replaces `engines.dshRange`, which dsh never
  read; the `-0` floor admits the 0.2 release candidates.

### Fixed

- **`RowsBlock` row layout**: each row is again the reference's bordered box
  (`catalogEntry`) around a grid row (`catalogRow` + the caller's column
  variant), inside a stacked list (`rowList`). The variant used to replace the
  grid instead of riding on it, so `FlagsBlock` rows dropped their delete
  control under the field, and the list itself was laid out as a row grid.
- **`RowsBlock` no longer blanks a settled list**: after a write settles the
  draft is dropped instead of being emptied under the served key, so a second
  commit of the same list (Enter then blur, or leaving an unchanged row) keeps
  drawing the served rows instead of an empty list.

### Added

- **`DropdownField`** (`./client/blocks`, `./client`): the `SelectField`
  choice drawn as the shared dropdown — the selector pill with its chevron
  anchoring the shell's `Menu`, the face `PickerBlock` wears — instead of the
  platform `<select>`. Same option rule (`selectOptions`); re-picking the held
  choice writes nothing; a disabled field never opens. It keeps its open
  state, so it is drawn as a component.
- **Asynchronous preparation in the fiber pool** (`createFiberPool`):
  `resolve` may answer a promise. The key reads `starting` (a fiber it
  already had keeps running) until the answer lands, which reconciles again;
  the answer is kept while the entry stands (`stableKey`), so the same entry
  never prepares twice. A late answer of a replaced, forgotten (off, removed,
  `invalidate`) or disposed preparation is dropped; a rejection, or one past
  the new `resolveMs`, is that key's `failed` line. `firstConnectMs` runs from
  the fiber's start, not the preparation's. New `pool.invalidate(id)` forces
  a key to prepare again; `ResolvedEntry` is exported. A synchronous
  `resolve` behaves exactly as before — except that one which throws is now
  that key's `failed` line instead of an exception out of `reconcile`.
- **Host-served choices** (`./client/blocks`): `ExtraField` takes
  `type: "select"`, which always draws a select — even before the Host served
  any option — and `SelectField` never loses the value it holds: a stored pick
  the served options no longer carry stays offered, labelled as itself;
  repeated values collapse; an empty value with a placeholder reads as the
  placeholder. The rule is exported as `selectOptions(value, served,
  placeholder?)`. Closes the deferred `catalogs[]` gap for the two consumers
  that asked (docker profiles, chrome executables): the choices travel in the
  consumer's own live mirror.
- `cross-spawn` as the package's first runtime dependency (the wrapper's
  `.cmd`/`.bat` resolution on Windows, same as the MCP SDK's transport).

## 0.2.0

The mechanism holes the three consumers (and the manager's dogfooding) asked
for, each as a typed hole with its own test. None is domain code — a plugin
with odd logic still fits alongside, never inside.

### Added

- **Multi-namespace capture**: `captureToolResults` answers against one prefix,
  a set of prefixes, or a predicate (`matchesToolName`, exported from
  `./host`) — one row standing behind N namespaces captures all of them, and a
  predicate that throws matches nothing: a capture never changes what runs.
- **Entry actions** (`entryActions`): `attachSettingsForm`'s `actions` hole now
  answers **per key** for a keyed nonce — every key whose stamp moved fires
  `run(key)` exactly once; a key that merely stands, or disappeared (a row
  dropped), fires nothing; scalar nonces keep their whole-value diff exactly as
  before. The client writes a keyed nonce with
  `controller.writeEntryTrigger(field, key)` (read-modify-write of the map) and
  waits it with `controller.settleEntryTrigger(...)`.
- **`settleField`**: the descriptor/controller name the live field whose diff
  settles a host-run wait (`controller.settleTrigger(field, watch?)`) — what
  moves is the answer; the wall clock stays the backstop.
- **`toasts`**: `mountSettingsCard({ toasts?: boolean | { host } })` mounts the
  page-wide toast root that mirrors the notices the controller stages (the
  wait's stall report, write failures). Idempotency keys on the root (two cards,
  one page, one root — the stylesheet injector's rule); mount and teardown ride
  the effect; with no DOM the notices keep staging and nothing is drawn.
- **`t` in `bind`**: a block's `bind` answers with the copy door as its third
  argument — a bind that renders copy never re-derives it.
- **Fiber pool** (`createFiberPool`, `./host`): the keyed map, diff, start,
  switch-in-place, dispose, ceiling (`cap`, counted against what a reconcile
  leaves live) and first-connect deadline (`firstConnectMs`) behind one spec, so
  a row that means "one live thing per entry" answers lines and errors instead
  of rewriting them.
- **Value diff** (`sameValue` / `stableKey`, `./host`): one rule for both planes
  — key order never reads as a change, array order always does, and unset,
  `null` and absent are the same answer. Values that are not maps or lists
  (`Date`, `RegExp`, `Map`, `Set`, boxed primitives) compare by what they are,
  and a value built in another realm is still read for what it is.
- **Volatile reads** (`readVolatile`, `./host`): one read path for the live
  reference a `.volatile()` field arrives as and the plain value anything built
  by hand arrives as; every container the read meets comes back copied, so
  sorting or filtering what one holds never edits the row.
- **Registry view** (`toolNamesByNamespace`, `./host`): which tools a server
  really serves, answered by filtering `mcp__<namespace>__` out of the shell's
  registry — a surface that does not answer is named once, not read as "none".
- **Global registry** (`createGlobalRegistry`, `./host`): one keyed map shared by
  every copy of the package under a namespaced identity (`Symbol.for(...)` or
  `"<package>/what"`; a bare word throws), with re-registration, idempotent
  disposers, and a reason when nothing answers an id.
- **Catalog `fields`** (`CatalogRules`): the key/trim/order/cap rules read after
  dedupe and cap, so a keyed list never re-rules the same three things.
- **`t` in `renderSummary`**: the summary hook answers copy through the door the
  body already carries.
- **Editor controls** (`./client/blocks`): `TextField`, `LinesField`, `MapField`,
  `SelectField` and `ExtraField` (the declared `type` seam) — a blank line drops
  on the way out, not while drawing, and a `MapField` splits on the first `=`.
- **Row switch** (`SwitchField({ variant: "row" })`): the control alone, no box
  and no title line.
- **Shared sheet families** (`./styles`): `injectCardStyles(sheets?)` injects the
  shared sheet plus any card's own, once per page each; three shared families
  (live lines, tools, summary) stop being re-declared by every card.
- **`liveKeys = ∅`**: a card that states no live mirror answers zero `unset`
  ops, and the form attaches with the empty list.

### Fixed — or rather: pinned

- `createPersister` no longer requires `liveKeys`: a card that states no mirror
  answers zero `unset` ops (nothing to fold back), and the form attaches with
  the empty list.
- Non-intrusion stands: `apply()` touches exactly one surface — the row-config
  slot — and reaches the DOM only through the declared toast hole.

## 0.1.0

First absorbed surface. One place where a dsh 0.2 change gets fixed once.

### Added

- **Package shape**: dual planes (`./host` Node ESM via `tsc`;
  `./client` browser bundle registered with the shell's module loader under
  `@comecaramelos/dsh-ancesters/client`, plus `./client/blocks`, `./styles`
  and `./locales` subpaths), `engines.dshRange = ">=0.2.0 <0.3.0"`.
- **Identity**: `requireEntryId` / `rowConfigKey` — the row key is derived from
  the profile entry id, never from the instance name; a non-profile mount
  fails loud.
- **Primitives** (host rules, mirrored on the browser plane): catalog id/name
  rows with merge-by-id, extra-flags rules with the connect-mode skip, WSL /
  Windows-executable platform probes, error classification with the
  known-executable-missing families, and the stderr log wrapper (127 rule,
  private log dir).
- **Settings mechanism** (`./host` adapter): `attachSettingsForm` (auto page
  off, disposed with the effect; user-field commit routing; trigger/nounce holes
  with fold-then-diff), `createLiveMirror` (coalesced volatile publish, no-echo,
  settle-before-commit), `createPersister` (one `unset` per live key on every
  write, mirror re-asserted on both sides), `createRunChain` (one run at a time
  from a context-free resource), `captureBridgeLog` / `captureToolResults`.
- **Shared widgets** (`./client/blocks`): `RowsBlock`, `DialogBlock`,
  `PickerBlock`, `FlagsBlock`, `SwitchField`, `LinkButtonRow`, `ErrorLine` —
  promoted out of the reference checkouts, all domain behavior turned into
  holes.
- **Shared sheet + injector** (`./styles`): one `<style>` per sheet per page,
  keyed by content hash, not by consumer.
- **Locales** (`./locales`): `dshAncesters` namespace, plugin dictionaries
  merged over the shared keys.
- **Card machinery** (`./client`): `CardController` (staged vs immediate writes,
  write-budget re-issues, settle waits with stall notices),
  `mountSettingsCard(spec)` — styles → locales → controller → row registration,
  in that order; a card that reads nothing renders nothing.
- **Tests**: every 0.2 lesson carries its own test (re-issue, no-echo,
  unset+re-assert, nonce-no-launch, context-free chain), plus loader/build/
  compat/surface checks.
