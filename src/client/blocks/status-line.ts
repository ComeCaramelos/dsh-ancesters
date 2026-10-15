/**
 * Small shared parts: {@link LinkButtonRow} (the control line several blocks
 * carry under their content) and {@link ErrorLine} (the body's one error line).
 *
 * The error line is *the body's own line*: since 0.2 the Plugins page owns the
 * container and the identity line, and a failure is stated on a single line
 * inside the body — never on a shell/header of its own (contratos-dsh §8).
 * `tone` marks what the line carries: an error (the state is classified by
 * `host/status`, here it only draws what it is told) or the known
 * executable-missing state — both render the same red dot, the way the
 * reference cards draw them.
 */
import { jsx, jsxs } from "react/jsx-runtime";
import STYLES from "../styles/shared.module.css";

/** One line of link-styled controls, side by side. */
export function LinkButtonRow(props: { children?: unknown }): any {
    return jsxs("div", { className: STYLES.linkButtonRow, children: props.children === undefined ? [] : [props.children] });
}

/**
 * The body's error line.
 * @param props.text - the failure line, already capped by the caller. Empty
 *        renders nothing: no line, no dot, no empty `role="status"`.
 */
export function ErrorLine(props: { text: string }): any {
    const text = String(props.text ?? "");
    if (text === "") return null;
    return jsxs("p", {
        className: STYLES.error,
        role: "status",
        children: [jsx("span", { className: STYLES.dot + " " + STYLES.dotError, "aria-hidden": "true" }), jsx("span", { children: text })
        ]
    });
}
