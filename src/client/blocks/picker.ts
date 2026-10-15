/**
 * PickerBlock — one Menu pill over the saved rows plus the catalog list you can
 * refresh, extend by hand and prune (the reference cards' picker, unchanged in
 * shape: field row → disclosure → rows).
 *
 * The row list itself is `./rows.js`, read here through two fields (the wire id
 * and the display name) and folded behind a collapsed `<details>` disclosure, so
 * only the field row and the dropdown are visible until the list is opened.
 *
 * Extra controls under the rows arrive through `actions` — the reference card's
 * **Fetch executables** and the extra buttons of one consumer or another all
 * ride that one line; the shared half carries none of them itself.
 */
/// <reference path="../shell-modules.d.ts" />
import { jsx, jsxs } from "react/jsx-runtime";
import { Menu } from "@deepseek-ai/dsh-client-ui-primitives";
import STYLES from "../styles/shared.module.css";
import { CHEVRON_PATH } from "./icons.js";
import { RowsBlock } from "./rows.js";

/** One dropdown option: the wire id and the label the pill shows. */
export interface PickerOption {
    id: string;
    label: string;
    /** Whether the dropdown tags this id as broken (the run could not use it). */
    disabled?: boolean;
}

/** One extra control under the rows. */
export interface PickerAction {
    label: string;
    title?: string;
    disabled?: boolean;
    onClick: () => unknown;
}

/** Everything the picker draws; it owns no state but the menu open/closed. */
export interface PickerBlockProps {
    /** Saved rows: `id` goes on the wire, `name` is the card label ("" → the id). */
    entries: readonly { id: string; name: string }[];
    /** Dropdown options (usually the saved rows plus whatever is in use). */
    options: readonly PickerOption[];
    selectedId: string;
    /** Labels the pill carries when a selection exists. */
    selectedLabel: string;
    /** Pill tooltip (the resolved path, or the reason it is unresolved). */
    selectedTitle?: string;
    /** Menu open/closed is the consumer's (only one menu may be open per card). */
    menuOpen: boolean;
    setMenuOpen: (open: boolean) => void;
    /** The pill's selection changed: the whole routing is the consumer's. */
    select: (id: string) => unknown;
    /** Whole-list write of the saved rows (id/name pairs); the consumer's host
     * normalizes on the way in and re-runs the source the new ids imply. */
    save?: (entries: readonly { id: string; name: string }[]) => unknown;
    /** The refresh trigger (host run) — the reference's *Fetch executables*. */
    refresh: () => unknown;
    refreshLabel: string;
    busyLabel?: string;
    /** Extra controls riding the rows' action line. */
    actions?: readonly PickerAction[];
    writable?: boolean;
    busy?: boolean;
    /** Field row copy. */
    selectorLabel?: string;
    hint?: string;
    /** Row list copy. */
    idLabel?: string;
    nameLabel?: string;
    idPlaceholder?: string;
    namePlaceholder?: string;
    addLabel?: string;
    removeLabel?: string;
    emptyText?: string;
    rowsLabel?: string;
    /** One status line below everything (the probe answer, say) — drawn by the
     * caller, the picker just keeps its place. */
    statusLine?: unknown;
}

export function PickerBlock(props: PickerBlockProps): any {
    const entries = Array.isArray(props.entries) ? props.entries : [];
    const options = Array.isArray(props.options) ? props.options : [];
    const selectedId = props.selectedId === undefined ? "" : props.selectedId;
    const writable = props.writable === true;
    const busy = props.busy === true;
    // The saved rows are what the list renders: `id` goes on the wire, `name`
    // is what the card shows ("" → render the id).
    const rows: string[][] = entries.map((entry) => [entry.id, entry.name]);

    /**
     * A whole-list write: the list owns the draft, the consumer's host
     * normalizes on the way in and re-runs the source the new ids imply.
     */
    const saveEntries = (next: string[][]) => {
        if (props.save === void 0) return Promise.resolve();
        return Promise.resolve(props.save(next.map((row) => ({ id: row[0] ?? "", name: row[1] ?? "" }))));
    };

    const refreshAction = () =>
        jsx("button", {
            type: "button",
            className: STYLES.linkButton,
            disabled: !writable || busy,
            onClick: () => {
                props.refresh();
            },
            children: busy && props.busyLabel !== void 0 ? props.busyLabel : props.refreshLabel
        });

    /** The refresh plus whatever the consumer adds ride the rows' action line. */
    const extras = props.actions === void 0 ? [] : props.actions;
    const renderActions = () =>
        jsxs("div", {
            className: STYLES.linkButtonRow,
            children: [
                refreshAction(),
                ...extras.map((action, index) =>
                    jsx("button", {
                        type: "button",
                        className: STYLES.linkButton,
                        disabled: !writable || busy || action.disabled === true,
                        title: action.title === void 0 ? "" : action.title,
                        onClick: () => {
                            action.onClick();
                        },
                        children: action.label
                    }, index)
                )
            ]
        });

    return jsxs("div", {
        className: STYLES.catalog,
        children: [
            jsxs("div", {
                className: STYLES.field,
                children: [
                    jsxs("div", {
                        className: STYLES.fieldRow,
                        children: [
                            props.selectorLabel === undefined || props.selectorLabel === "" ? null : jsx("span", { className: STYLES.fieldTitle, children: props.selectorLabel }),
                            jsx("span", {
                                className: STYLES.selectorWrap,
                                children: jsx(Menu, {
                                    open: props.menuOpen === true,
                                    onClose: () => {
                                        props.setMenuOpen(false);
                                    },
                                    items: options.map((option) => ({ id: option.id, label: option.label })),
                                    selectedId: options.some((option) => option.id === selectedId) ? selectedId : "",
                                    onSelect: (id: string) => {
                                        props.setMenuOpen(false);
                                        props.select(id);
                                    },
                                    align: "end",
                                    portal: true,
                                    anchor: jsxs("button", {
                                        type: "button",
                                        className: STYLES.selector,
                                        "aria-haspopup": "menu",
                                        "aria-expanded": props.menuOpen === true,
                                        disabled: !writable || busy,
                                        title: props.selectedTitle === void 0 ? "" : props.selectedTitle,
                                        onClick: () => {
                                            props.setMenuOpen(!(props.menuOpen === true));
                                        },
                                        children: [
                                            // A bare label; a path needs its own
                                            // truncating span.
                                            jsx("span", { className: STYLES.selectorLabel, children: props.selectedLabel }),
                                            jsx("svg", {
                                                width: 14,
                                                height: 14,
                                                className: STYLES.pillChevron,
                                                viewBox: "0 0 14 14",
                                                fill: "none",
                                                "aria-hidden": "true",
                                                children: jsx("path", { d: CHEVRON_PATH, fill: "currentColor" })
                                            })
                                        ]
                                    })
                                })
                            })
                        ]
                    }),
                    props.hint === undefined ? null : jsx("div", { className: STYLES.fieldDesc, children: props.hint })
                ]
            }),
            RowsBlock({
                values: rows,
                save: saveEntries,
                labels: [props.idLabel === void 0 ? "" : props.idLabel, props.nameLabel === void 0 ? "" : props.nameLabel],
                placeholders: [props.idPlaceholder === void 0 ? "" : props.idPlaceholder, props.namePlaceholder === void 0 ? "" : props.namePlaceholder],
                writable: props.writable,
                busy: busy,
                emptyLabel: props.emptyText,
                addLabel: props.addLabel,
                removeLabel: props.removeLabel,
                disclosureLabel: props.rowsLabel,
                disclosure: true,
                rowClassName: STYLES.catalogRow,
                renderAction: renderActions
            }),
            props.statusLine === undefined || props.statusLine === null ? null : props.statusLine
        ]
    });
}
