# `@comecaramelos/dsh-ancesters`

Shared **base layer** for DeepSeek Harness plugins. It is **not a plugin**:
no `cordis.patch.yml`, no bundle, no entry in the Plugins list. It is the
dependency that *absorbs the dsh 0.2 surface* — identity, settings form, live
mirror, write-back, runs, captures, widgets — so a dsh change breaks **one**
place and gets fixed **once**, instead of every consumer at once.

Used by `@comecaramelos/dsh-mcp-manager`, `@comecaramelos/dsh-chrome-mcp` and
`@comecaramelos/dsh-docker-desktop-mcp`.

## Planes

| import | plane | emits |
|---|---|---|
| `@comecaramelos/dsh-ancesters` / `./host` | Node (ESM) | `lib/host/*` via `tsc` |
| `@comecaramelos/dsh-ancesters/client` | browser | `lib/client.js` — loader module (`window.__ModuleLoader__`) |
| `.../client/blocks`, `.../styles`, `.../locales` | browser | plain ESM bundled into the consumer's own client half |

A consumer pairs the loader half inside its own `lib/client.js`; the id the
loader registers under is `@comecaramelos/dsh-ancesters/client`, unique to the
ancestor.

## Usage (the shape all consumers take)

```ts
// host (dsh-<plugin>/src/index.ts)
import {
    attachSettingsForm, createLiveMirror, createPersister, createRunChain, captureBridgeLog
} from "@comecaramelos/dsh-ancesters/host";

export function apply(ctx) {
    const runs = createRunChain();
    const form = attachSettingsForm(ctx, {
        userFields: ["extraFlags", "executables", "refreshNonce"],
        liveKeys: ["lastError", "resolvedPath"],
        actions: { refreshNonce: () => runs.queue(refresh) },  // nonce hole
        onCommit: routeDomainCommits                       // routing hole
    });
    const live = createLiveMirror(ctx, { read: () => liveAnswers() });
    const persistUser = createPersister(ctx, {
        form, liveKeys: ["lastError", "resolvedPath"], publishLive: live.publish
    });
    const bridgeLog = captureBridgeLog(scopedLogger, (line) => classify(line));
}
```

```ts
// client (dsh-<plugin>/src/client/index.ts)
import { mountSettingsCard } from "@comecaramelos/dsh-ancesters/client";

export const { apply, inject } = mountSettingsCard({
    entryId,                 // profile entry id (the row key half)
    pluginId,                // package identity (the row key half)
    bundleId,                // the bundle whose patch declares the row — defaults to pluginId
    placement,               // "row" (default): the row's own page · "bundle": the bundle page the list opens
    localeNamespace,         // default: `dshAncesters`, merged under the plugin's own keys
    fields: { staged, immediate, triggers, liveKeys },
    blocks,                  // declared widgets: field + action + liveKey holes
    locale                   // plugin dictionaries; win over the shared keys
});
```

## Export map

| subpath | what |
|---|---|
| `.` / `./host` | Node half: identity, catalog/flags/platform/status/stderr rules, the Settings adapter (`attachSettingsForm`, live mirror, `persistUser`), `createRunChain`, `createFiberPool` (N live fibers behind one list field), `createGlobalRegistry`, the registry view (`toolNamesByNamespace`), `sameValue`/`stableKey`, captures |
| `./client` | Loader module — `mountSettingsCard`, blocks re-exports |
| `./client/blocks` | Shared widgets (`RowsBlock`, `DialogBlock`, `PickerBlock`, `FlagsBlock`, `SwitchField`, `ComposerPill`, `LinkButtonRow`, `ErrorLine`) and the editor controls (`TextField`, `LinesField`, `MapField`, `SelectField`, `DropdownField`, `ExtraField`) — see [docs/knowledge/inputs.md](docs/knowledge/inputs.md) |
| `./styles` | The shared sheet + idempotent injector (`injectCardStyles`) |
| `./locales` | Shared locale namespace + merge rule |

Every capability the framework adds enters through a *typed hole*
(props/callbacks/hooks) — never through a flat `config`. A plugin with odd
logic fits alongside `ancesters`; `ancesters` never grows to imitate it.

## Compatibility

dsh `^0.2.0` (0.2.0 and 0.2.1). It checks each dsh surface by its shape and fails
loudly on a build it doesn't support. Which surfaces it relies on and the dsh 0.2 quirks
it absorbs: [docs/knowledge/compatibility.md](docs/knowledge/compatibility.md).

## Development

```sh
npm test       # builds both halves, runs test/*.test.mjs
npm run build  # lib/host/* + lib/client.js (+ lib/{blocks,styles,locales}.js)
```

Coding agents: read [AGENTS.md](AGENTS.md).

## License

MIT
