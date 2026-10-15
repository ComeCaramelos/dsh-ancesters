/**
 * FlagsBlock — the free-form string list: a title (+ optional guide link) over
 * the rows, one column per row (the value itself).
 *
 * Same widget shape as {@link PickerBlock}'s row list, which is what makes the
 * reference cards read as one component set; read through the single field a
 * flag actually has. Nothing about the list's rules changes here: blur/Enter
 * commits the whole list, a delete persists on the spot, and a blank added row
 * stays local until it carries text (the write side rejects an empty value).
 *
 * Append controls (the reference's *Restore defaults* / *Flags WSL*, or
 * anything else a consumer wants) arrive through `actions`, each one merging
 * against the rows currently visible — keep everything the rows carry, append
 * only what is missing. The shared half carries no list of its own; the served
 * source stays the consumer's.
 */
/// <reference path="../shell-modules.d.ts" />
import { jsx, jsxs } from "react/jsx-runtime";
import STYLES from "../styles/shared.module.css";
import { DOCS_PATHS } from "./icons.js";
import { RowsBlock } from "./rows.js";

/** One append control riding the list's action line. */
export interface FlagsBlockAction {
    /** Control label. */
    label: string;
    /** Control tooltip. */
    title?: string;
    /** Composes what the write will carry, given what is visible now. */
    merged: (visible: string[]) => readonly string[];
    /** Whether the control is disabled (the served source being empty is the
     * usual reason — nothing to recover, nothing to append). */
    disabled?: boolean;
}

/** What the block draws. */
export interface FlagsBlockProps {
    /** The saved list. */
    flags: readonly string[];
    /** Whole-list write: the consumer's host validates and re-applies. */
    save: (flags: string[]) => unknown;
    /** Title line. */
    title: string;
    /** Hint under the title. */
    hint?: string;
    /** Optional configuration-guide link riding the title line. */
    link?: { href: string; label: string; title?: string };
    /** The append controls. */
    actions?: readonly FlagsBlockAction[];
    /** Row-list copy. */
    rowLabel?: string;
    rowPlaceholder?: string;
    addLabel?: string;
    removeLabel?: string;
    emptyText?: string;
    /** Fold the rows behind a `<details>`, like the picker does. */
    disclosure?: boolean;
    disclosureLabel?: string;
    writable?: boolean;
    busy?: boolean;
}

export function FlagsBlock(props: FlagsBlockProps): any {
    const writable = props.writable === true;
    const busy = props.busy === true;
    const flags = Array.isArray(props.flags) ? props.flags : [];

    /** A whole-list write of the plain values (one column per row). */
    const saveValues = (next: string[][]) => {
        const cleaned = next
            .map((row) => String(row === undefined || row === null ? "" : row[0] ?? "").trim())
            .filter((flag) => flag !== "")
            .filter((flag, index, all) => all.indexOf(flag) === index);
        if (typeof props.save !== "function") return Promise.resolve();
        return Promise.resolve(props.save(cleaned));
    };

    const actions = props.actions === void 0 ? [] : props.actions;

    /** One control: merges against what the user is looking at right now, so an
     * action can never drop what is already there. */
    const renderAction = (visible: readonly (readonly string[])[]) =>
        jsxs("div", {
            className: STYLES.linkButtonRow,
            children: actions.map((action, index) =>
                jsx(
                    "button",
                    {
                        type: "button",
                        className: STYLES.linkButton,
                        disabled: !writable || busy || action.disabled === true,
                        title: action.title === void 0 ? action.label : action.title,
                        onClick: () => {
                            if (!writable || busy) return;
                            const current = visible.map((row) => String(row[0] ?? "").trim()).filter((flag) => flag !== "");
                            const merged = Array.from(new Set([...current, ...action.merged(current)]));
                            void saveValues(merged.map((flag) => [flag]));
                        },
                        children: action.label
                    },
                    index
                )
            )
        }, "actions");

    return jsxs("div", {
        className: STYLES.catalog,
        children: [
            jsxs("div", {
                className: STYLES.field,
                children: [
                    jsxs("div", {
                        className: STYLES.fieldRow,
                        children: [
                            jsx("span", { className: STYLES.fieldTitle, children: props.title }),
                            props.link === undefined || props.link.href === ""
                                ? null
                                : jsxs("a", {
                                    className: STYLES.docsLink,
                                    href: props.link.href,
                                    target: "_blank",
                                    rel: "noopener noreferrer",
                                    title: props.link.title === void 0 ? props.link.label : props.link.title,
                                    children: [
                                        jsx("svg", {
                                            className: STYLES.docsIcon,
                                            width: 14,
                                            height: 14,
                                            viewBox: "0 0 24 24",
                                            fill: "none",
                                            stroke: "currentColor",
                                            strokeWidth: 2,
                                            strokeLinecap: "round",
                                            strokeLinejoin: "round",
                                            "aria-hidden": "true",
                                            children: DOCS_PATHS.map((d: string, at: number) => jsx("path", { d: d }, at))
                                        }),
                                        jsx("span", { className: STYLES.docsLinkLabel, children: props.link.label })
                                    ]
                                })
                        ]
                    }),
                    props.hint === undefined ? null : jsx("div", { className: STYLES.fieldDesc, children: props.hint })
                ]
            }),
            RowsBlock({
                values: flags.map((flag) => [flag]),
                save: saveValues,
                labels: [props.rowLabel === void 0 ? "" : props.rowLabel],
                placeholders: [props.rowPlaceholder === void 0 ? "" : props.rowPlaceholder],
                writable: props.writable,
                busy: busy,
                emptyLabel: props.emptyText,
                addLabel: props.addLabel,
                removeLabel: props.removeLabel,
                disclosureLabel: props.disclosureLabel,
                disclosure: props.disclosure === true,
                rowClassName: STYLES.catalogRowSingle,
                inputClassName: STYLES.catalogInput,
                renderAction
            })
        ]
    });
}
