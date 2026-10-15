/**
 * `@comecaramelos/dsh-ancesters/client/blocks` — types.
 *
 * Presentational components, promoted from the reference checkouts. Keep this
 * surface identical to `src/client/blocks/index.ts`; `test/exports.test.mjs`
 * cross-checks the bundle's runtime keys against the names declared here.
 */

/** One row's field values, in column order. */
export type RowValues = string[];

export declare function RowsBlock(props: any): any;
export declare const RowList: typeof RowsBlock;

export declare function DialogBlock(props: any): any;
export declare function PickerBlock(props: any): any;
export declare function FlagsBlock(props: any): any;
export declare function SwitchField(props: any): any;
export declare function LinkButtonRow(props: { children?: unknown }): any;
export declare function ErrorLine(props: { text: string }): any;

/* --- The five editor controls every keyed-list editor draws (H8). */
/** What each of the five takes: value in, `onChange` out — nothing else. */
export interface FieldProps {
    /** Field title (also the control's accessible name). */
    label: string;
    /** Hint line under the control. */
    help?: string;
    /** The value as the host answers it. */
    value: unknown;
    /** The only door out. */
    onChange(value: unknown): void;
    placeholder?: string;
    disabled?: boolean;
}

/** A `SelectField` choice. */
export interface SelectOption {
    value: unknown;
    label: string;
}

/** A field an extension seam declared (`type` picks the control). */
export interface ExtraFieldProps extends FieldProps {
    type?: "string" | "lines" | "boolean" | "secret" | "select";
    options?: readonly SelectOption[];
}

export declare function TextField(props: FieldProps): any;
export declare function LinesField(props: FieldProps): any;
export declare function MapField(props: FieldProps): any;
export declare function SelectField(props: FieldProps & { options?: readonly SelectOption[] }): any;
/** The same choice, drawn as the shared dropdown (selector pill + `Menu`);
 * it keeps its open state, so draw it as a component. */
export declare function DropdownField(props: FieldProps & { options?: readonly SelectOption[] }): any;
export declare function ExtraField(props: ExtraFieldProps): any;

/** The parsing behind `LinesField`/`MapField` (a blank line drops, a map
 * splits on the first `=`), exported because a consumer may read the same way. */
export declare function parseLines(value: string): string[];
export declare function parseMap(value: string): Record<string, string>;
export declare function mapEntries(value: unknown): Array<{ key: string; value: string }>;
/** What a `SelectField` offers: the served options, the held value when they
 * no longer carry it, and an empty choice when a placeholder names one. */
export declare function selectOptions(value: unknown, served: readonly SelectOption[], placeholder?: string): SelectOption[];

/** The block set, by name. */
export declare const Blocks: Record<string, (props: any) => any>;

/* --- The composer pill (R6): a Menu on a pill in the conversation input row. */
export interface ComposerPillSpec {
    key: string;
    label: string;
    title?: string;
    ariaLabel?: string;
    icon?: readonly string[];
    options: readonly { id: string; label: string }[];
    selectedId: string;
    onSelect(id: string): unknown;
    disabled?: boolean;
}
export interface ComposerPillProps extends ComposerPillSpec {
    open: boolean;
    setOpen(open: boolean): void;
}
export declare function ComposerPill(props: ComposerPillProps): any;
