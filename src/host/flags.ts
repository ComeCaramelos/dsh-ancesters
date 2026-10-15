/**
 * Extra-flags rules shared by every bridge consumer: validation of
 * user-authored flag lists, the connect-mode predicate, and list equality.
 *
 * Flags are execve'd as argv entries — never through a shell — so validation
 * rejects control characters only; spaces inside values are valid. A plugin
 * may add its own rules through `rules.reject` (chrome rejects executable-pin
 * flags as a second source of truth for the picker's own lever); the shared
 * half never grows an `if` for one plugin's domain.
 */

/** Control characters (C0 + DEL). Everything else is valid argv content. */
export const CONTROL_PATTERN = /[\x00-\x1f\x7f]/u;

/** One user-authored flags list, or the unknown a settings layer hands in. */
export type ExtraFlags = unknown;

/** What a consumer's domain adds to the shared validation. */
export interface FlagsRules {
    /** Extra per-flag check. Return an error message when the flag must be
     * refused; the message is reported verbatim, so the offending entry is
     * quoted inside it. */
    reject?: (flag: string) => string | null;
}

/**
 * Validate a user-authored extraFlags list: a plain array of non-empty flag
 * strings carrying no control characters, plus whatever the consumer's domain
 * refuses. Throws with the offending entry so the settings layer can surface
 * it.
 * @returns true when valid.
 */
export function validateExtraFlags(value: ExtraFlags, rules: FlagsRules = {}): true {
    if (!Array.isArray(value)) {
        throw new Error("extraFlags must be an array of strings");
    }
    for (const flag of value) {
        if (typeof flag !== "string" || flag === "") {
            throw new Error("extraFlags entries must be non-empty strings");
        }
        if (CONTROL_PATTERN.test(flag)) {
            throw new Error(`extraFlags entry "${flag}" contains control characters`);
        }
        if (rules.reject !== void 0) {
            const refusal = rules.reject(flag);
            if (refusal !== null && refusal !== void 0) {
                throw new Error(`extraFlags entry "${flag}" ${refusal}`);
            }
        }
    }
    return true;
}

/** True when one extraFlag declares a connect mode (no local executable to
 * launch — the bridge connects, it does not spawn). */
export function carriesConnectionMode(flag: string): boolean {
    return typeof flag === "string" && /^--(?:browserUrl|wsEndpoint)(?:=|(?=\s)|$)/iu.test(flag);
}

/** True when any entry of a flags list declares connect mode — the predicate
 * that spares a host run its executable probe. */
export function flagsSkipCheck(flags: ExtraFlags): boolean {
    return Array.isArray(flags) && flags.some((flag) => typeof flag === "string" && carriesConnectionMode(flag));
}

/** True when two flags lists are element-wise equal. */
export function sameFlags(a: ExtraFlags, b: ExtraFlags): boolean {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((flag, index) => flag === (b as string[])[index]);
}
