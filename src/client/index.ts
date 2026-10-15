/**
 * Browser half, public surface.
 *
 * `dsh-ancesters` is not a plugin: the loader module registered here is not a
 * settings page of its own, it is the *factory* every consumer's client half is
 * built from. A plugin calls {@link mountSettingsCard} with its descriptor and
 * re-exports the returned `{ apply, inject }` as its own plugin body.
 *
 * The machinery itself is `./apply.ts` — styles, locales, controller and the
 * row registration, in that fixed order. A plugin body imports exactly one
 * thing from here and composes its blocks; nothing else about how dsh answers
 * configuration reaches the consumer.
 */
import { mountSettingsCard as mountSettingsCardBody, type CardBlockSpec, type MountedSettingsCard, type SettingsCardSpec } from "./apply.js";

/** A block entry of a settings card body (see `./apply`). */
export type { CardBlockSpec };

/** The descriptor that makes a card (see `./apply`). */
export type { SettingsCardSpec };

/** What a plugin re-exports as its own browser body (see `./apply`). */
export type { MountedSettingsCard };

/** Alias of a block entry; kept for descriptor authors who name it this way. */
export type CardBlock = CardBlockSpec;

/**
 * Bind a plugin's descriptor into the shared settings-card machinery.
 * @throws controlled, named error when the descriptor is missing or unusable.
 */
export function mountSettingsCard(spec?: SettingsCardSpec): MountedSettingsCard {
    return mountSettingsCardBody(spec);
}

/**
 * Phase marker, test-facing: the loader module materialized under
 * `@comecaramelos/dsh-ancesters/client` exists and is callable.
 */
export const dshAncestersClientPhase = 1;

/**
 * Services the client half needs (mirrors a plugin body's `inject`). Consumers
 * of `mountSettingsCard` normally re-export their own `inject` derived from the
 * mounted card; this is the default set a card always needs.
 */
export const inject: readonly string[] = ["configForms", "slots", "locale"];

/**
 * Browser entry the loader calls. A bare call is always an error: the shared
 * card machinery has no identity of its own — a consumer must mount it with a
 * descriptor first. Fails controlled, never crashes silently.
 */
export function apply(ctx?: unknown): void {
    throw new Error(
        "dsh-ancesters/client: apply(ctx) answers through the card a plugin mounted — call mountSettingsCard(spec).apply(ctx) from the plugin body"
    );
}

/**
 * The shared widget set and helpers, re-exported so one import of
 * `@comecaramelos/dsh-ancesters/client` is enough for a consumer body. Each of
 * these has its own emitted bundle for consumers that prefer addressing the
 * subpath export directly; esbuild dedupes both routes into one copy.
 */
export {
    Blocks,
    RowsBlock,
    RowList,
    DialogBlock,
    PickerBlock,
    FlagsBlock,
    SwitchField,
    LinkButtonRow,
    ErrorLine,
    TextField,
    LinesField,
    MapField,
    SelectField,
    DropdownField,
    ExtraField,
    ComposerPill
} from "./blocks/index.js";
export { injectCardStyles, SHEET_ID, sheetId } from "./styles/index.js";
export { LOCALE_NAMESPACE, DICTIONARIES, mergeDictionaries } from "./locales/index.js";
export { normalizeEntries, mergeEntries, isValidEntryId, entryLabel, entryIds, findEntry } from "./catalog.js";
export type { CatalogRow, CatalogRules } from "./catalog.js";
export { CardController, MAX_WRITE_PASSES, RUN_SETTLE_TIMEOUT_MS, nothingCardSnapshot } from "./controller/index.js";
export type { CardControllerSpec, CardFields, CardSnapshot, ConfigForm, ConfigFormOp, ConfigFormSnapshot, ConfigPageForm } from "./controller/index.js";
