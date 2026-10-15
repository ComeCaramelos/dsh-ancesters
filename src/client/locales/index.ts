/**
 * Common locale dictionaries.
 *
 * Keys the card mechanisms need everywhere — `apply`, `discard`, `saving`,
 * `unsaved`, `saveFailed`, `cancel`, `close`, `search*`, `addSelected`, … — live
 * under the namespace `dshAncesters` so every plugin inherits them instead of
 * compounding them. A plugin merges its own dictionaries on top of these; where
 * the same key means something plugin-specific (`search*`, `cancel`), the
 * plugin wins by the merge rule (riesgo #3 of the plan).
 */

/** Namespace the shared keys register under. */
export const LOCALE_NAMESPACE = "dshAncesters";

/** Keys shared by every card, one dictionary per locale. Keyed by the ids the
 * shell's locale service declares (`zh`, `en` — `LOCALE_IDS` in dsh's
 * `client/locale`): a dictionary under any other id (`en-US`) is never read,
 * and every key it carries comes back as the key itself. */
export const DICTIONARIES: Record<string, Record<string, string>> = {
    en: {
        apply: "Apply",
        discard: "Discard",
        saving: "Saving…",
        unsaved: "Unsaved changes",
        saveFailed: "Save failed",
        cancel: "Cancel",
        close: "Close",
        search: "Search",
        searchNoResults: "No matches",
        searchPlaceholder: "Search…",
        addSelected: "Add selected",
        // The page-wide notices (`toasts`): a wait that ended with nothing
        // answered, and a failure the Host answered without a line of its own.
        toastStall: "The host did not answer the action — try it again.",
        toastError: "The host reported a failure."
    }
};

/**
 * Merge a plugin's dictionaries over the shared ones.
 *
 * The plugin's keys win on collision: a key whose meaning is plugin-specific
 * (`search*`, `cancel` read as the plugin's own button) is exactly the case
 * where the shared text would be wrong. What stays shared is what no plugin
 * redefines.
 * @param base - the shared dictionaries (usually {@link DICTIONARIES}).
 * @param override - the plugin's own, one per locale.
 */
export function mergeDictionaries(
    base: Record<string, Record<string, string>> = DICTIONARIES,
    override: Record<string, Record<string, string>> = {}
): Record<string, Record<string, string>> {
    const merged: Record<string, Record<string, string>> = {};
    for (const locale of [...Object.keys(base), ...Object.keys(override)]) {
        merged[locale] = { ...(base[locale] === void 0 ? {} : base[locale]), ...(override[locale] === void 0 ? {} : override[locale]) };
    }
    return merged;
}
