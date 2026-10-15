# dsh compatibility

`engines.dsh` in `package.json` (`^0.2.0-0`: every 0.2 build, release candidates
included) declares the dsh range this version supports — it is the field dsh's own
plugin compatibility check reads.

The adapter checks each dsh surface by its shape, never by comparing version strings,
and fails loudly against a build it doesn't support: a surface missing its shape answers
once with `this dsh build is not supported`.

| dsh surface | how it is used | used by |
|---|---|---|
| `settings.describe` | one call per live publish; a describe with no raw change emits nothing | live mirror, form attach |
| `settings.configure` | disposable, once per fiber (`{ auto: false }`) — the card owns the row's page | `attachSettingsForm` |
| `settings.mutate` | ops written by profile entry id; the last pass writes unfenced (dsh 0.2.1 moves the revision when it reconciles live keys) | `persistUser` |
| `entry.update(config, false, false)` | volatile commit: persists nothing, never remounts | live mirror |
| `loader/volatile-update` | commit paths per document change; also re-asserts the mirror after a persist resets volatile fields | commit routing, live mirror |
| `tools/post-execute` | settled tool results for this host's own tools | `captureToolResults` |
| `tools` registry view (`schemas()`) | read through the context, filtered by `mcp__<namespace>__`; no answer means *no tools*, said once | `toolNamesByNamespace` |

## Things dsh 0.2 does that consumers must not fight

- Locale dictionaries are only read under the ids dsh declares (`en`, `zh`); a
  dictionary under `en-US` is never used.
- `Fiber.update()` doesn't return the restart; wait with `fiber.await()` before
  reporting a connection as connected.
- Persisting any row recomposes the profile and resets every row's volatile fields, so
  live state must be published again after a save (the live mirror does this).
