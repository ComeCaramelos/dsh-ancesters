# Inputs

The input widgets `./client/blocks` offers a consumer's settings card. They all draw;
none of them fetches, polls or persists. The value comes in as the Host answers it,
and the change goes out through one callback; what a write means is the card's
business (`test/surface.test.mjs` keeps it that way).

A card names a widget in its descriptor (`blocks: [{ block: "FlagsBlock", field, … }]`)
or draws it directly (`jsx(TextField, …)`). Which fields stage and which land at once
is set by `fields` in `mountSettingsCard`, not by the widget:

| `fields` key | write semantics |
|---|---|
| `staged` | a draft, persisted by apply / dropped by discard |
| `immediate` | written on the spot (rows, selections) |
| `triggers` | an immediate write of `Date.now()` — a nonce that asks the Host to run |
| `liveKeys` | Host answers, shown and never edited |

## Editor controls

One value each. Common props (`FieldProps`): `label` (also the accessible name),
`help`, `value`, `onChange(value)`, `placeholder`, `disabled`.

| control | draws | value it answers |
|---|---|---|
| `TextField` | one-line text input | `string` |
| `LinesField` | textarea, one item per line | `string[]`; blank lines drop on the way out, spaces inside a line stay |
| `MapField` | textarea, one `KEY=value` per line | `Record<string, string>`; split on the **first** `=`, a keyless line drops |
| `SelectField` | native `<select>` (+ `options`) | the picked option's `value` |
| `DropdownField` | same choice as `SelectField`, drawn as the shell's selector pill + `Menu` | same as `SelectField` |
| `ExtraField` | whatever its declared `type` asks for (below) | per type |

`SelectField` / `DropdownField` never lose the value they hold: a stored pick the
served `options` no longer carry stays offered, labelled as itself. An empty value with
a `placeholder` reads as the placeholder, never as the first option.

`ExtraField` is the extension seam — a field a plugin's extension declares by shape:

| `type` | control |
|---|---|
| `string` (default) | `TextField`, or `SelectField` when `options` is non-empty |
| `lines` | `LinesField` |
| `boolean` | checkbox → `boolean` |
| `secret` | password input → `string` |
| `select` | `SelectField`, even before the Host serves any option |

Unknown types draw a text line. The parsers are exported for the host side to read
the same way: `parseLines`, `parseMap`, `mapEntries`, `selectOptions`.

## Switch

`SwitchField` — the shell's `Switch` primitive. Props: `label`, `hint`, `title`
(tooltip), `checked` (the state the Host resolves), `onToggle()`, `disabled`, `busy`,
`variant: "block"` (default, a catalog box with its title) or `"row"` (the bare switch,
for a live line that already names it).

## List and choice blocks

| block | what it edits | write |
|---|---|---|
| `RowsBlock` (alias `RowList`) | a list of rows, one text box per column (`labels` fixes the column count) | `save(rows)` — whole list; blur/Enter commits, delete persists at once, an added blank row stays local until it carries text |
| `FlagsBlock` | a free-form string list (one column), optional guide `link` | `save(flags)` — trimmed, empties and duplicates dropped; `actions` append via `merged(visible)` |
| `PickerBlock` | a selection pill over saved `{ id, name }` rows, plus the row list behind a disclosure | `select(id)` for the pick, `save(entries)` for the rows, `refresh()` for the Host run, extra `actions` |
| `DialogBlock` | a modal checklist of `candidates` a run returned; saved ids show checked and disabled | `onAdd(ids)` merges the checked ids; `onClose()` writes nothing |
| `ComposerPill` | a `Menu` pill in the conversation input's tool row (the `composer` hole) | `onSelect(id)`, only when the pick differs |

`busy` / `writable` (or `disabled`) keep a block inert while a write is in flight or
the row is read-only. Menu open/closed state (`PickerBlock`, `ComposerPill`) is held by
the caller.

## Not inputs

`LinkButtonRow` (the control line under a block) and `ErrorLine` (the body's single
error line) only draw.
