/**
 * SwitchField — a switch rendered as one catalog block (title + switch inline,
 * hint below), so it reads exactly like the picker block (and inherits the same
 * seam rule: only the block-to-block seam draws a hairline).
 *
 * The Switch primitive renders only the control and names it through `label`,
 * which becomes the control's aria-label; the tooltip therefore lives on the
 * wrapper span the switch is rendered inside.
 *
 * What the switch reads as "on" is the consumer's answer (the card shows what
 * the host actually resolves, never a phantom state); this half draws it.
 */
/// <reference path="../shell-modules.d.ts" />
import { jsx, jsxs } from "react/jsx-runtime";
import { Switch } from "@deepseek-ai/dsh-client-ui-primitives";
import STYLES from "../styles/shared.module.css";

/** A switch sitting inside one catalog block. */
export interface SwitchFieldProps {
    /** Field title (also the control's accessible name). */
    label: string;
    /** Hint line under the field row. */
    hint?: string;
    /** Tooltip carried by the wrapper (not by the control). */
    title?: string;
    /** The effective state as the host answers it. */
    checked: boolean;
    /** While false, the control reads on/off but does not accept clicks. */
    disabled?: boolean;
    /** Toggle request — the write is the consumer's. */
    onToggle: () => unknown;
    /** A write in flight (or the row read-only) keeps the control inert. */
    busy?: boolean;
    /**
     * `block` (default) sits in a catalog box with its title above the row;
     * `row` is the switch on its own, for a live line where the line already
     * names the control and a boxed block would read as a card inside a row
     * (rule H9 — the three switches a consumer writes by hand disappear).
     */
    variant?: "block" | "row";
}

/** One block that is a switch rather than a picker. */
export function SwitchField(props: SwitchFieldProps): any {
    const control = jsx(Switch, {
        checked: props.checked === true,
        label: props.label,
        disabled: props.disabled === true || props.busy === true,
        onChange: () => {
            if (typeof props.onToggle === "function") props.onToggle();
        }
    });

    if (props.variant === "row") {
        return jsx("span", {
            className: STYLES.toggleLabel,
            title: props.title === void 0 ? props.label : props.title,
            "aria-label": props.label,
            children: control
        });
    }

    return jsxs("div", {
        className: STYLES.catalog,
        children: [
            jsxs("div", {
                className: STYLES.field,
                children: [
                    jsxs("div", {
                        className: STYLES.fieldRow,
                        children: [
                            jsx("span", { className: STYLES.fieldTitle, children: props.label }),
                            jsx("span", {
                                className: STYLES.toggleLabel,
                                title: props.title === void 0 ? props.label : props.title,
                                children: control
                            })
                        ]
                    }),
                    props.hint === undefined ? null : jsx("div", { className: STYLES.fieldDesc, children: props.hint })
                ]
            })
        ]
    });
}
