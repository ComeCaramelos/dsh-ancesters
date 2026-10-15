/**
 * Shared blocks.
 *
 * Presentational pure functions: data + callbacks in, nothing else. No block
 * may reach a config-form service, a slot registration, a config *describe* or
 * an entry *update* — those arrive as props from the card machinery
 * (`../apply`), and a block that reaches past its props is a breakage waiting
 * to move elsewhere (the rule `test/surface.test.mjs` enforces).
 *
 * Everything here was promoted from `dsh-chrome-mcp/src/client/card/` (the
 * reference, identical across the checkouts); names changed only where a name
 * carried one consumer's domain (`CandidateDialog` → `DialogBlock`,
 * `CatalogPicker` → `PickerBlock`, `ExtraFlagsEditor` → `FlagsBlock`,
 * `LogOutputToggle` → `SwitchField`).
 */
import { RowsBlock } from "./rows.js";
import { DialogBlock } from "./dialog.js";
import { PickerBlock } from "./picker.js";
import { FlagsBlock } from "./flags.js";
import { SwitchField } from "./toggle.js";
import { LinkButtonRow, ErrorLine } from "./status-line.js";
import { DropdownField, ExtraField, LinesField, MapField, SelectField, TextField } from "./controls.js";
import { ComposerPill } from "./pill.js";

export { RowsBlock, RowList } from "./rows.js";
export type { RowValues, RowsBlockProps, SaveRows } from "./rows.js";
export { DialogBlock } from "./dialog.js";
export type { DialogBlockProps, DialogCandidate } from "./dialog.js";
export { PickerBlock } from "./picker.js";
export type { PickerBlockProps, PickerOption, PickerAction } from "./picker.js";
export { FlagsBlock } from "./flags.js";
export type { FlagsBlockProps, FlagsBlockAction } from "./flags.js";
export { SwitchField } from "./toggle.js";
export type { SwitchFieldProps } from "./toggle.js";
export { LinkButtonRow, ErrorLine } from "./status-line.js";
export { DropdownField, ExtraField, LinesField, MapField, SelectField, TextField, mapEntries, parseLines, parseMap, selectOptions } from "./controls.js";
export type { FieldProps, SelectOption, ExtraFieldProps } from "./controls.js";
export { ComposerPill } from "./pill.js";
export type { ComposerPillProps, ComposerPillSpec } from "./pill.js";
export { CHEVRON_PATH, TRASH_PATH, CLOSE_PATHS, DOCS_PATHS } from "./icons.js";

/** The block set by name (a consumer may index it from its descriptor). */
export const Blocks = {
    RowsBlock,
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
};
