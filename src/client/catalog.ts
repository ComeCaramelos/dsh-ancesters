/**
 * Browser-half mirror of `src/host/catalog.ts`.
 *
 * The same rules, from the same source — a whole point of `ancesters` is that
 * the id/name rules, normalization and merge-by-id are a single implementation,
 * not two copies kept honest by fixtures. The host module is pure (no `node:`
 * imports), so the client bundle carries the very same code, and
 * `test/catalog.test.mjs` still pins both planes against shared fixtures to
 * catch the one drift that matters: a rule that was widened into a domain.
 */
export type { CatalogRow, CatalogRules } from "../host/catalog.js";
export {
    NAME_MAX_LENGTH,
    ENTRY_CAP,
    ID_MAX_LENGTH,
    isValidEntryId,
    entryLabel,
    normalizeEntries,
    mergeEntries,
    entryIds,
    findEntry
} from "../host/catalog.js";
