/**
 * Identity — the shared row key and profile-entry id rules.
 *
 * The whole `ancesters` surface keys everything by the **profile entry id**
 * read off the fiber's own loader entry: configuration lives on the row since
 * dsh 0.2 (`plugins.row.config`, keyed `<package name>#<row id>`), and two
 * instances that invent their own key would silently alias each other. So the
 * id is read, never derived, never defaulted — a bare mount says so loudly.
 *
 * No dsh surface is imported here; this is pure identity, safe for both planes.
 */

/** The narrowest view of a plugin context the rule reads. */
export interface EntryIdSource {
    /** Loader fiber; its entry carries the profile id. */
    fiber?: {
        entry?: {
            options?: {
                id?: unknown;
            };
        };
    };
}

/**
 * The profile entry id this instance is keyed by.
 * @throws when the plugin was not started as a profile entry — the id is the
 *         key every read and write goes through, so inventing one would alias
 *         (or silently address nothing) instead of failing loud.
 */
export function requireEntryId(ctx: EntryIdSource): string {
    const id = ctx?.fiber?.entry?.options?.id;
    if (typeof id !== "string" || id === "") {
        throw new Error(
            "dsh-ancesters: this instance is not a profile entry, so the row configuration has no entry id to address it by " +
                "(a bare plugin mount has no form — start it through the bundle patch or the plugin manager)"
        );
    }
    return id;
}

/**
 * The slot key a row configuration registers under: derived, never identity.
 * @param pkgName - the plugin package name (`@scope/name`).
 * @param entryId - the profile entry id (see {@link requireEntryId}).
 */
export function rowConfigKey(pkgName: string, entryId: string): string {
    if (typeof pkgName !== "string" || pkgName === "") {
        throw new Error("dsh-ancesters: rowConfigKey(pkg, entryId) requires a non-empty package name");
    }
    if (typeof entryId !== "string" || entryId === "") {
        throw new Error("dsh-ancesters: rowConfigKey(pkg, entryId) requires a non-empty entry id");
    }
    return `${pkgName}#${entryId}`;
}
