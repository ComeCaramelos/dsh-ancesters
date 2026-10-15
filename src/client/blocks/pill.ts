/**
 * The composer pill — a compact `Menu` anchored on a pill in the conversation
 * input's tool row (R6), the shape the shell's own mode/model pills take.
 *
 * Promoted out of `dsh-docker-desktop-mcp/src/client/composer.ts` with the
 * domain taken out: no profile, no brand. What it shows (the label, the
 * choices, an optional mark) and what a pick does arrive as props; whether the
 * list is open is the caller's state, handed in like `PickerBlock`'s menu, so
 * this stays a pure function of its props.
 *
 * Rules kept from the reference: picking what is already selected writes
 * nothing; a disabled pill (read-only row, write in flight) never opens; the
 * mark rides `currentColor`, so it follows the theme and the disabled state.
 */
/// <reference path="../shell-modules.d.ts" />
import { jsx, jsxs } from "react/jsx-runtime";
import { Menu } from "@deepseek-ai/dsh-client-ui-primitives";
import STYLES from "../styles/shared.module.css";
import { CHEVRON_PATH } from "./icons.js";

/** One pill as a consumer declares it. */
export interface ComposerPillSpec {
    /** Stable key among the pills one consumer draws. */
    key: string;
    /** What the pill reads (the current choice's label). */
    label: string;
    /** Tooltip — the thing being chosen, never the current choice. */
    title?: string;
    /** Accessible name; defaults to `title: label`. */
    ariaLabel?: string;
    /** Optional mark: stroke paths on a 24×24 box. */
    icon?: readonly string[];
    /** The choices. */
    options: readonly { id: string; label: string }[];
    /** The id currently chosen. */
    selectedId: string;
    /** A pick that is not the current one. */
    onSelect(id: string): unknown;
    /** Never opens while true. */
    disabled?: boolean;
}

/** What the pill block takes: the spec plus the open state its caller holds. */
export interface ComposerPillProps extends ComposerPillSpec {
    open: boolean;
    setOpen(open: boolean): void;
}

/** Draw one composer pill. */
export function ComposerPill(props: ComposerPillProps): any {
    const disabled = props.disabled === true;
    return jsx("span", {
        className: STYLES.composerPillRoot,
        "data-pill": props.key,
        children: jsx(Menu, {
            open: props.open && !disabled,
            onClose: () => props.setOpen(false),
            items: props.options,
            selectedId: props.selectedId,
            onSelect: (id: string) => {
                props.setOpen(false);
                if (id === props.selectedId) return;
                Promise.resolve(props.onSelect(id)).catch(() => void 0);
            },
            align: "start",
            side: "top",
            portal: true,
            anchor: jsxs("button", {
                type: "button",
                className: STYLES.composerPill,
                "aria-label": props.ariaLabel ?? (props.title === undefined ? props.label : `${props.title}: ${props.label}`),
                title: props.title ?? props.label,
                "aria-haspopup": "menu",
                "aria-expanded": props.open && !disabled,
                disabled,
                onClick: () => props.setOpen(!props.open),
                children: [
                    props.icon === undefined || props.icon.length === 0
                        ? null
                        : jsx("span", {
                              className: STYLES.composerPillIcon,
                              "aria-hidden": true,
                              children: jsx("svg", {
                                  width: 14,
                                  height: 14,
                                  viewBox: "0 0 24 24",
                                  fill: "none",
                                  xmlns: "http://www.w3.org/2000/svg",
                                  children: props.icon.map((d, at) =>
                                      jsx("path", { d, stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }, at)
                                  )
                              })
                          }),
                    jsx("span", { className: STYLES.composerPillLabel, children: props.label }),
                    jsx("span", {
                        className: STYLES.composerPillChevron + (props.open && !disabled ? " " + STYLES.composerPillChevronOpen : ""),
                        "aria-hidden": true,
                        children: jsx("svg", {
                            width: 14,
                            height: 14,
                            viewBox: "0 0 14 14",
                            fill: "none",
                            xmlns: "http://www.w3.org/2000/svg",
                            children: jsx("path", { d: CHEVRON_PATH, fill: "currentColor" })
                        })
                    })
                ]
            })
        })
    });
}
