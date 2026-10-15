/**
 * Editor controls — the five every keyed list draws, once (H8).
 *
 * A list editor always shows the same handful of controls: one line, a list
 * of lines, a `KEY=value` map, a choice, and whatever an extension declared.
 * Before this file the shared blocks had *lists* (`RowsBlock`, `FlagsBlock`,
 `PickerBlock`) and a switch, but no field of one line, no multi-line list, and
 * no map — so every card wrote them again, and each copy read the syntax
 * slightly differently.
 *
 * The rules that belong to the mechanism, not to a card:
 *
 *   1. a blank line of a `LinesField` **drops at the door** (a space **inside**
 *      a value never gets trimmed: an argument may legitimately carry one). It
 *      drops on the way out, never while drawing: a box that redrew what the
 *      card stores would rewrite itself under the caret on every keystroke, so
 *      what the box shows is what was typed until the served answer moves
 *      (`useTypedBox`, the same served-sync idiom `RowsBlock` draws with);
 *   2. a `MapField` splits on the **first** `=`, and a keyless line drops —
 *      the same reading `FlagsBlock` gives, so one map never reads two ways;
 *   3. none of them writes to the Host: `onChange` is the only door, and the
 *      card decides what persistence means (the surface rule in
 *      `test/surface.test.mjs` is exactly what keeps this true);
 *   4. `ExtraField` reads the declared `type` (`string` | `lines` | `boolean` |
 *      `secret` | `select`) and draws the control that fits — which is what any
 *      extension seam needs, and today gets written from scratch in every
 *      plugin;
 *   5. a `SelectField` never loses the value it holds: options are often what
 *      the Host *discovered* (profiles, executables), and a stored pick the
 *      latest discovery no longer reports stays offered — labelled as itself —
 *      instead of the control silently showing another one. An empty value
 *      with a placeholder reads as that placeholder, never as the first option.
 *      `DropdownField` is the same choice under the same rule, drawn as the
 *      shared dropdown (the selector pill and `Menu` `PickerBlock` wears)
 *      instead of the platform `<select>`.
 *
 * They draw; they never fetch, poll or persist.
 */
/// <reference path="../shell-modules.d.ts" />
import * as react from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { Menu } from "@deepseek-ai/dsh-client-ui-primitives";
import STYLES from "../styles/shared.module.css";
import { CHEVRON_PATH } from "./icons.js";

/** What every one of these five takes. */
export interface FieldProps {
    /** Field title (also the control's accessible name). */
    label: string;
    /** Hint line under the control. */
    help?: string;
    /** The value as the host answers it — never a local guess. */
    value: unknown;
    /** The only door out: what the control became. */
    onChange(value: unknown): void;
    /** Placeholder for a control that is empty. */
    placeholder?: string;
    /** Read-only row, or a write in flight. */
    disabled?: boolean;
}

/** A `SelectField` choice. */
export interface SelectOption {
    value: unknown;
    label: string;
}

/** What an extension seam declares one of its fields as. */
export interface ExtraFieldProps extends FieldProps {
    /** The declared shape; unknown shapes draw a text line. */
    type?: "string" | "lines" | "boolean" | "secret" | "select";
    /** Choices a `select` (or a `string`) field offers — typically what the
     * Host served for it, re-read on every render. */
    options?: readonly SelectOption[];
}

/** One line of text (the usual single-value field). */
export function TextField(props: FieldProps): any {
    return field(props, jsx("input", {
        type: "text",
        className: STYLES.control,
        value: text(props.value),
        placeholder: props.placeholder ?? "",
        disabled: props.disabled === true,
        "aria-label": props.label,
        onChange: (event: { target: { value: string } }) => props.onChange(event.target.value)
    }));
}

/** A list held as one item per line — blank lines drop on the way out. */
export function LinesField(props: FieldProps): any {
    const box = useTypedBox(linesOf(props.value).join("\n"));
    return field(props, jsx("textarea", {
        className: STYLES.textarea,
        value: box.text,
        placeholder: props.placeholder ?? "",
        disabled: props.disabled === true,
        "aria-label": props.label,
        onChange: (event: { target: { value: string } }) => {
            const typed = event.target.value;
            box.stage(typed);
            props.onChange(parseLines(typed));
        }
    }));
}

/** A map held as one `KEY=value` per line. */
export function MapField(props: FieldProps): any {
    const box = useTypedBox(serializeMap(props.value));
    return field(props, jsx("textarea", {
        className: STYLES.textarea,
        value: box.text,
        placeholder: props.placeholder ?? "",
        disabled: props.disabled === true,
        "aria-label": props.label,
        onChange: (event: { target: { value: string } }) => {
            const typed = event.target.value;
            box.stage(typed);
            props.onChange(parseMap(typed));
        }
    }));
}

/** A choice out of a handful of answers. */
export function SelectField(props: FieldProps & { options?: readonly SelectOption[] }): any {
    const options = selectOptions(props.value, props.options ?? [], props.placeholder);
    return field(
        props,
        jsx("select", {
            className: STYLES.select,
            value: text(props.value),
            disabled: props.disabled === true,
            "aria-label": props.label,
            onChange: (event: { target: { value: string } }) => {
                const picked = options.find((option) => text(option.value) === event.target.value);
                props.onChange(picked === void 0 ? event.target.value : picked.value);
            },
            children: options.map((option) =>
                jsx("option", { value: text(option.value), children: option.label }, text(option.value))
            )
        })
    );
}

/**
 * A choice drawn as the shared dropdown: the filled selector pill with its
 * chevron, anchoring the shell's `Menu`. What it offers is `SelectField`'s rule
 * 5 (`selectOptions`); whether the list is open is the only state it keeps, so
 * it is drawn as a component (`jsx(DropdownField, …)`), never called inline.
 */
export function DropdownField(props: FieldProps & { options?: readonly SelectOption[] }): any {
    const openState = react.useState<boolean>(false);
    const open = openState[0];
    const setOpen = openState[1];
    const disabled = props.disabled === true;
    const options = selectOptions(props.value, props.options ?? [], props.placeholder);
    const held = text(props.value);
    const current = options.find((option) => text(option.value) === held);
    return field(
        props,
        jsx("span", {
            className: STYLES.selectorWrap,
            children: jsx(Menu, {
                open: open && !disabled,
                onClose: () => setOpen(false),
                items: options.map((option) => ({ id: text(option.value), label: option.label })),
                selectedId: current === void 0 ? "" : held,
                onSelect: (id: string) => {
                    setOpen(false);
                    if (id === held) return;
                    const picked = options.find((option) => text(option.value) === id);
                    props.onChange(picked === void 0 ? id : picked.value);
                },
                align: "start",
                portal: true,
                anchor: jsxs("button", {
                    type: "button",
                    className: STYLES.selector,
                    "aria-haspopup": "menu",
                    "aria-expanded": open && !disabled,
                    "aria-label": props.label,
                    disabled,
                    onClick: () => setOpen(!open),
                    children: [
                        jsx("span", { className: STYLES.selectorLabel, children: current === void 0 ? props.placeholder ?? "" : current.label }),
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
    );
}

/**
 * A field declared by an extension seam: whatever the kind did not know about.
 * Draws the control the declared `type` asks for, and answers it the same way.
 */
export function ExtraField(props: ExtraFieldProps): any {
    const type = props.type === void 0 ? "string" : props.type;
    // The control the `type` names is drawn as a **component**, never called: a
    // control that stands its own state up (`LinesField`'s typed box) called inline
    // hands that state to whoever is drawing, so a control appearing, disappearing
    // or swapping between renders moves the hook list underneath the card and
    // React refuses the render. The `type` is still read off the declaration and
    // never worked out per render — only the drawing moves.
    if (type === "boolean") {
        return field(
            props,
            jsx("input", {
                type: "checkbox",
                className: STYLES.checkbox,
                checked: props.value === true,
                disabled: props.disabled === true,
                "aria-label": props.label,
                onChange: (event: { target: { checked: boolean } }) => props.onChange(event.target.checked)
            })
        );
    }
    if (type === "lines") return jsx(LinesField, props);
    // A declared choice stays a choice even before the Host has served any:
    // falling back to a text line would let a user type what only discovery
    // may answer.
    if (type === "select") return SelectField(props);
    if (type === "secret") {
        return field(
            props,
            jsx("input", {
                type: "password",
                className: STYLES.control,
                value: text(props.value),
                placeholder: props.placeholder ?? "",
                disabled: props.disabled === true,
                "aria-label": props.label,
                onChange: (event: { target: { value: string } }) => props.onChange(event.target.value)
            })
        );
    }
    if ((props.options ?? []).length > 0) return SelectField(props);
    return TextField(props);
}

/**
 * What a select actually offers: the served options, plus the held value when
 * they no longer carry it (rule 5), plus an empty choice when nothing is held
 * and a placeholder says what to pick. Duplicates by value collapse to the
 * first, so a served list that repeats itself never draws two rows.
 */
export function selectOptions(value: unknown, served: readonly SelectOption[], placeholder?: string): SelectOption[] {
    const out: SelectOption[] = [];
    const seen = new Set<string>();
    const held = text(value);
    if (held === "" && placeholder !== void 0 && placeholder !== "" && !served.some((option) => text(option.value) === "")) {
        out.push({ value: "", label: placeholder });
        seen.add("");
    }
    for (const option of served) {
        const key = text(option.value);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(option);
    }
    if (held !== "" && !seen.has(held)) out.push({ value, label: held });
    return out;
}

/**
 * A lines control's value as items: a list as written, or one newline-joined
 * string (the same reading either way, so a card that stores lines as text
 * still draws them instead of answering an empty box).
 */
function linesOf(value: unknown): string[] {
    if (Array.isArray(value)) return value.map((item) => text(item)).filter((item) => item.trim() !== "");
    if (typeof value === "string") return parseLines(value);
    return [];
}

/**
 * One multi-line box's text — the served-sync idiom every block already uses.
 *
 * What the card stores is not what is being typed: a blank line, or a `KEY` whose
 * `=` has not been typed yet, is not a value, so drawing the stored answer under
 * the caret rewrites the box on every keystroke (the newline a user stands at the
 * end of a list is the usual victim). The box therefore shows what was typed
 * while the served answer it was derived from still stands, and falls back to
 * that answer the moment it moves.
 */
function useTypedBox(served: string): { text: string; stage(text: string): void } {
    const typedState = react.useState<{ key: string; text: string }>({ key: "", text: "" });
    const typed = typedState[0];
    const setTyped = typedState[1];
    return {
        text: typed.key === served ? typed.text : served,
        stage: (text: string): void => setTyped({ key: served, text })
    };
}

/** Any value as the text one control carries. */
function text(value: unknown): string {
    if (value === void 0 || value === null) return "";
    return typeof value === "string" ? value : String(value);
}

/**
 * Split one control's text into items.
 *
 * A blank line is not an item — it is the gap a card must not persist — while
 * everything else survives **exactly** as written: spaces inside a line belong
 * to the value, so an argument may carry one, and trimming the line would
 * silently rewrite what the user typed.
 */
export function parseLines(text: string): string[] {
    return String(text)
        .split("\n")
        .filter((line) => line.trim() !== "");
}

/**
 * Read one `KEY=value` control.
 *
 * Splitting is on the **first** `=` only, so a value may carry `=` (a query
 * string, a base64 tail). A line with no key drops — `=value` is not a pair —
 * and neither the key's nor the value's own spaces go.
 */
export function parseMap(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of String(text).split("\n")) {
        if (line.trim() === "") continue;
        const split = line.indexOf("=");
        if (split <= 0) continue;
        const key = line.slice(0, split);
        if (key.trim() === "") continue;
        out[key] = line.slice(split + 1);
    }
    return out;
}

/** The map shape a `MapField` answers. */
export function mapEntries(value: unknown): Array<{ key: string; value: string }> {
    return Object.entries(parseMap(textMapSource(value))).map(([key, item]) => ({ key, value: String(item) }));
}

/** One control's value as the text the map serializer wants. */
function textMapSource(value: unknown): string {
    if (typeof value === "string") return value;
    if (value !== null && typeof value === "object") {
        return Object.entries(value as Record<string, unknown>)
            .map(([key, item]) => `${key}=${mapText(item)}`)
            .join("\n");
    }
    return "";
}

/** A map value's own text: a list joins with commas, a nested map keeps its
 * shape as JSON. Neither may land as `[object Object]`, which the next read
 * could not parse back. */
function mapText(value: unknown): string {
    if (value === void 0 || value === null) return "";
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map((item) => text(item)).join(",");
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
}

/** Render a map back into the control's one-pair-per-line shape. */
function serializeMap(value: unknown): string {
    if (typeof value === "string") return value;
    if (value === null || typeof value !== "object" || Array.isArray(value)) return "";
    return Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => `${key}=${mapText(item)}`)
        .join("\n");
}

/** The title/hint wrapper every one of the five shares. */
function field(props: FieldProps, control: unknown): unknown {
    return jsxs("div", {
        className: STYLES.controlField,
        children: [
            jsx("div", { className: STYLES.controlTitle, children: props.label }),
            control,
            props.help === undefined || props.help === "" ? null : jsx("div", { className: STYLES.fieldDesc, children: props.help })
        ]
    });
}
