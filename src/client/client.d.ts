/**
 * `@comecaramelos/dsh-ancesters/client` — types.
 *
 * The bundle is one emitted file (`lib/client.js`) registered with the shell's
 * module loader under `@comecaramelos/dsh-ancesters/client`; consumers import
 * `mountSettingsCard` and re-export the mounted body. Keep this surface
 * identical to `src/client/index.ts` — `test/build.test.mjs` cross-checks the
 * bundle's runtime keys against the names declared here.
 */
import type { CardBlockSpec, MountedSettingsCard, SettingsCardSpec } from "./apply.js";

export type { CardBlockSpec, SettingsCardSpec, MountedSettingsCard, CardBodyProps, BrowserCardContext } from "./apply.js";

/** Alias of a block descriptor entry. */
export type CardBlock = CardBlockSpec;

export declare function mountSettingsCard(spec?: SettingsCardSpec): MountedSettingsCard;
export declare const inject: readonly string[];
export declare function apply(ctx?: unknown): void;
export declare const dshAncestersClientPhase: number;

/* --- Blocks (the same names `./blocks` exports, re-exported for one import). */
export declare const Blocks: Record<string, (props: any) => any>;
export declare function RowsBlock(props: any): any;
export declare const RowList: typeof RowsBlock;
export declare function DialogBlock(props: any): any;
export declare function PickerBlock(props: any): any;
export declare function FlagsBlock(props: any): any;
export declare function SwitchField(props: any): any;
export declare function LinkButtonRow(props: { children?: unknown }): any;
export declare function ErrorLine(props: { text: string }): any;
export declare function TextField(props: any): any;
export declare function LinesField(props: any): any;
export declare function MapField(props: any): any;
export declare function SelectField(props: any): any;
export declare function DropdownField(props: any): any;
export declare function ExtraField(props: any): any;
/** A composer pill: a Menu anchored on a pill in the conversation input row (R6). */
export declare function ComposerPill(props: any): any;

/* --- Styles: the idempotent injector of the shared sheet. */
export declare function injectCardStyles(sheets?: readonly string[]): void;
export declare const SHEET_ID: string;
export declare function sheetId(css: string): string;

/* --- Locale: the shared namespace + merge rule. */
export declare const LOCALE_NAMESPACE: string;
export declare const DICTIONARIES: Record<string, Record<string, string>>;
export declare function mergeDictionaries(
    base?: Record<string, Record<string, string>>,
    override?: Record<string, Record<string, string>>
): Record<string, Record<string, string>>;

/* --- Catalog rules shared with the host plane. */
export declare function isValidEntryId(id: unknown, rules?: { idRule?: (id: string) => boolean }): boolean;
export declare function normalizeEntries(value: unknown): { id: string; name: string }[];
export declare function mergeEntries(stored: unknown, ids: unknown, rules?: unknown): { entries: { id: string; name: string }[]; changed: boolean };
export declare function entryLabel(entry: unknown): string;
export declare function entryIds(entries: unknown): string[];
export declare function findEntry(entries: unknown, id: string): { id: string; name: string } | undefined;

/* --- The card controller: the write door + store the card body renders. */
export declare function CardController(this: unknown, form?: unknown, spec?: unknown): void;
export declare const MAX_WRITE_PASSES: number;
export declare const RUN_SETTLE_TIMEOUT_MS: number;
export declare function nothingCardSnapshot(): unknown;
