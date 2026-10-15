/**
 * RowsBlock — the catalog row list shared by every picker/flags block.
 *
 * A row is a bordered box of text fields in column order, every box ending on
 * the row's delete control; the list opens on the empty line and closes on the
 * add control.
 *
 * Rows come from the served snapshot with a local draft overlaying them only
 * while an edit is pending: typing does not persist, a blur/Enter commits the
 * whole list, a delete persists immediately, and "add" appends a local blank
 * row that only becomes a saved row once it carries text. Once the field is
 * idle, the next host push (a merge that added rows, or a defaults restore)
 * becomes the view again — so a block never holds the machine's answer
 * hostage, and never edits the machine's answer in place.
 *
 * The list action belongs to the caller (`renderAction`) and is handed the
 * rows exactly as they are visible plus the write that persists them; the
 * shared half carries no list-merge rule of its own.
 */
/// <reference path="../shell-modules.d.ts" />
import * as react from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import STYLES from "../styles/shared.module.css";
import { TRASH_PATH } from "./icons.js";

/** One row's field values, in column order. */
export type RowValues = string[];

/** Persist one whole row list; the write side re-normalizes what lands. */
export type SaveRows = (rows: RowValues[]) => unknown;

/** Shape knobs every caller may pass. */
export interface RowsBlockProps {
    /** The served rows, as the host serves them. */
    values?: readonly (readonly string[])[];
    /** Whole-list write. */
    save?: SaveRows;
    /** One label per column (also fixes the column count). */
    labels?: readonly string[];
    /** One placeholder per column. */
    placeholders?: readonly string[];
    /** False while the host is busy or the row is read-only. */
    writable?: boolean;
    busy?: boolean;
    /** Fold the whole list behind a `<details>` ("Customized settings" idiom). */
    disclosure?: boolean;
    disclosureLabel?: string;
    /** `{count}` is replaced with the row count. */
    disclosureCountLabel?: string;
    /** Column variant: single-field lists pass the single-column classes. */
    rowClassName?: string;
    inputClassName?: string;
    /** One control line under the list, drawn by the caller. */
    renderAction?: (visible: readonly (readonly string[])[]) => unknown;
    /** Empty line, shown only when there are no rows and one is supplied. */
    emptyLabel?: string;
    addLabel?: string;
    addTitle?: string;
    removeLabel?: string;
}

/**
 * Render one catalog's row list — the empty line, the rows and the add control.
 */
export function RowsBlock(props: RowsBlockProps): any {
    const served: readonly (readonly string[])[] = Array.isArray(props.values) ? props.values : [];
    const writable = props.writable === true;
    const busy = props.busy === true;
    const labels: readonly string[] = Array.isArray(props.labels) ? props.labels : [];
    const placeholders: readonly string[] = Array.isArray(props.placeholders) ? props.placeholders : [];
    const columns = Math.max(1, labels.length);
    const blankRow: string[] = [];
    for (let blank = 0; blank < columns; blank++) blankRow.push("");

    // Served-sync idiom: a new served list resets the draft wholesale.
    const servedKey = JSON.stringify(served);
    const draftState = react.useState<{ key: string; rows: string[][] }>({ key: "", rows: [] });
    const draft = draftState[0];
    const setDraft = draftState[1];
    const rows = draft.key === servedKey ? draft.rows : (served.map((row) => Array.from(row)) as string[][]);

    /** A whole-list write: the list owns the draft, the caller owns the wire. */
    const write = (next: string[][]) => {
        const saved = props.save === void 0 ? undefined : props.save(next);
        return Promise.resolve(saved === void 0 ? undefined : saved).then(
            () => {
                // Settled: the served view is authoritative again. The draft is
                // dropped, not emptied under the served key: a write that
                // answers the list already served (a blur after an Enter, an
                // unchanged row) would otherwise draw that list as empty.
                setDraft({ key: "", rows: [] });
            },
            (failure: unknown) => {
                throw failure;
            }
        );
    };

    /** Edit a cell locally — a draft, until blur/Enter commits. */
    const setCell = (at: number, column: number, value: string) => {
        const next = rows.map((row, index) => (index === at ? row.map((cell, cellIndex) => (cellIndex === column ? value : cell)) : row.slice()));
        setDraft({ key: servedKey, rows: next });
    };

    /** Commit: trim every cell, drop rows with nothing in any cell. */
    const commit = () => {
        const cleaned: string[][] = [];
        for (const row of rows) {
            const cells = row.map((cell) => String(cell ?? "").trim());
            if (cells.some((cell) => cell !== "")) cleaned.push(cells);
        }
        return write(cleaned);
    };

    const remove = (at: number) => {
        return write(rows.filter((_row, index) => index !== at));
    };

    /** Add locally; the row only persists once it carries text. */
    const add = () => {
        setDraft({ key: servedKey, rows: rows.concat([blankRow.slice()]) });
    };

    // The column variant rides *on top of* the grid row (the reference's
    // `catalogRow + rowClassName`): on its own it only names columns, and a row
    // drawn with it alone stacks its delete control under the field.
    const rowClass = props.rowClassName === void 0 || props.rowClassName === STYLES.catalogRow ? STYLES.catalogRow : STYLES.catalogRow + " " + props.rowClassName;
    const inputClass = props.inputClassName === void 0 ? STYLES.catalogInput : props.inputClassName;

    const list = jsxs("div", {
        className: STYLES.rowList,
        children: [
            served.length === 0 && props.emptyLabel !== void 0 ? jsx("div", { className: STYLES.empty, children: props.emptyLabel }, "empty") : null,
            rows.map((row, at) =>
                jsx("div", {
                    className: STYLES.catalogEntry,
                    children: jsxs("div", {
                    className: rowClass,
                    children: [
                        row.map((cell, column) =>
                            jsx("input", {
                                className: inputClass,
                                type: "text",
                                value: cell === undefined ? "" : cell,
                                placeholder: placeholders[column] === undefined ? "" : placeholders[column],
                                disabled: !writable || busy,
                                onChange: (event: { target: { value: string } }) => {
                                    setCell(at, column, typeof event?.target?.value === "string" ? event.target.value : "");
                                },
                                onBlur: () => {
                                    if (writable && !busy) void commit();
                                },
                                onKeyDown: (event: { key: string; preventDefault?: () => void }) => {
                                    if (event.key === "Enter") {
                                        if (typeof event.preventDefault === "function") event.preventDefault();
                                        if (writable && !busy) void commit();
                                    }
                                }
                            }, column)
                        ),
                        jsx("button", {
                            type: "button",
                            className: STYLES.iconButton + " " + STYLES.iconButtonDanger,
                            disabled: !writable || busy,
                            title: props.removeLabel === void 0 ? "" : props.removeLabel,
                            onClick: () => {
                                if (writable && !busy) void remove(at);
                            },
                            children: jsx("svg", {
                                width: 14,
                                height: 14,
                                viewBox: "0 0 16 16",
                                fill: "none",
                                stroke: "currentColor",
                                children: jsx("path", { d: TRASH_PATH })
                            })
                        }, "remove")
                    ]
                    })
                }, at)
            ),
            jsx("button", {
                type: "button",
                className: STYLES.linkButton,
                disabled: !writable || busy,
                title: props.addTitle === void 0 ? "" : props.addTitle,
                onClick: () => {
                    if (!writable || busy) return;
                    add();
                },
                children: props.addLabel === void 0 ? "" : props.addLabel
            }, "add"),
            props.renderAction === void 0 ? null : props.renderAction(rows)
        ]
    });

    if (props.disclosure !== true) return list;
    return jsxs("details", {
        className: STYLES.disclosure,
        children: [
            jsxs("summary", {
                className: STYLES.disclosureSummary,
                children: [
                    jsx("span", { className: STYLES.disclosureLabel, children: props.disclosureLabel === void 0 ? "" : props.disclosureLabel }),
                    jsx("span", {
                        className: STYLES.disclosureCount,
                        children: (props.disclosureCountLabel === void 0 ? String(rows.length) : props.disclosureCountLabel).replace("{count}", String(rows.length))
                    })
                ]
            }),
            jsx("div", { className: STYLES.disclosureBody, children: list })
        ]
    });
}

/** The reference half's name; kept so the checkouts read unchanged. */
export const RowList = RowsBlock;
