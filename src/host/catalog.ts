/**
 * Catalog rows — the named rows behind picker dialogs (`client/blocks` mirror).
 *
 * A row is `{ id, name }`: the id goes on the wire (whatever the domain uses
 * it for — a path, a profile), `name` is purely the UI label. This module owns
 * the **rules** shared by every consumer — id validity, normalization,
 * merge-by-id, label, caps — never the domain that decides which rule applies
 * (chrome's executable-path rule and docker's profile/executable rules live
 * with their consumers and plug in as `idRule`).
 *
 * Everything here is pure and total: nothing throws on odd input, so no
 * validation path can stall a settings gate on a malformed row (the failure
 * that once left a reference plugin discovering nothing).
 *
 * The browser half mirrors these rules through `../client/blocks`' catalog
 * helpers; both sides pin against the same fixtures in `test/catalog.test.mjs`
 * so a drift between halves fails loudly.
 */

/** One catalog row: the wire id + the custom UI label. */
export interface CatalogRow {
    id: string;
    name: string;
}

/** How strict one catalog is: id rule, per-row name cap, list cap. */
export interface CatalogRules {
    /** Whether one id may go on the wire. Default rule below caps ids like a
     * command line (no control characters, trimmed). */
    idRule?: (id: string) => boolean;
    /** Max length of one row's display name. Defaults to {@link NAME_MAX_LENGTH}. */
    nameMax?: number;
    /** Max number of rows; the tail drops off. Defaults to {@link ENTRY_CAP}. */
    cap?: number;
    /**
     * Whatever extra fields a row carries — every list of rows is a list of
     * *something*, and the something stays the consumer's. It runs **after**
     * the id rule, the dedupe and the cap, so an unusable id can never spend a
     * slot in the budget on its way out.
     */
    fields?: (row: unknown) => Record<string, unknown> | undefined;
}

/** Cap of one row's display name (chrome + docker agree on it). */
export const NAME_MAX_LENGTH = 200;

/** Cap of the saved rows; the tail drops off so a merged run can never grow
 * the persisted list without limit. */
export const ENTRY_CAP = 50;

/** Cap of one id when the consumer does not supply a stricter rule. */
export const ID_MAX_LENGTH = 1024;

/** Default id rule: a trimmed non-empty id carrying no control characters,
 * capped like the reference's `COMMAND_MAX_LENGTH`. Spaces inside a value are
 * valid; only control characters make an id unusable. */
const DEFAULT_ID_PATTERN = /^[^\x00-\x1f\x7f]{1,1024}$/u;

/** Whether one id is usable as a row id under one rule set. */
export function isValidEntryId(id: unknown, rules: CatalogRules = {}): boolean {
    if (typeof id !== "string") return false;
    const trimmed = id.trim();
    if (trimmed === "") return false;
    return rules.idRule === void 0 ? DEFAULT_ID_PATTERN.test(trimmed) : rules.idRule(trimmed);
}

/** One row label: the custom name when it has one, else the id itself. */
export function entryLabel(entry: CatalogRow): string {
    const name = String(entry?.name ?? "").trim();
    return name === "" ? entry.id : name;
}

/**
 * Coerce anything into well-formed rows: trim both fields, drop ids the rule
 * cannot use, keep the first row per id, cap the name, cap the list.
 *
 * A `fields` hook runs **after** the dedupe and the cap, so the extra half a
 * consumer carries never spends a slot in the list's budget (rule H6).
 */
export function normalizeEntries(value: unknown, rules: CatalogRules = {}): CatalogRow[] {
    if (!Array.isArray(value)) return [];
    const cap = rules.cap === void 0 ? ENTRY_CAP : rules.cap;
    const nameMax = rules.nameMax === void 0 ? NAME_MAX_LENGTH : rules.nameMax;
    const rows: CatalogRow[] = [];
    const sources: unknown[] = [];
    const seen = new Set<string>();
    for (const item of value) {
        if (rows.length === cap) break;
        if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
        const raw = item as { id?: unknown; name?: unknown };
        const id = typeof raw.id === "string" ? raw.id.trim() : "";
        if (!isValidEntryId(id, rules) || seen.has(id)) continue;
        seen.add(id);
        const name = typeof raw.name === "string" ? raw.name.trim() : "";
        rows.push({ id, name: name.slice(0, nameMax) });
        sources.push(item);
    }
    if (rules.fields === void 0) return rows;
    return rows.map((row, index) => {
        const extra = rules.fields?.(sources[index]);
        return extra === void 0 || typeof extra !== "object" ? row : { ...row, ...extra };
    });
}

/**
 * Merge ids a source reported into stored rows: rows keep their order and
 * their custom names, ids not represented land last, nameless.
 * @returns the merged rows plus `changed` so a caller can skip a no-op write.
 */
export function mergeEntries(
    stored: unknown,
    ids: readonly string[],
    rules: CatalogRules = {}
): { entries: CatalogRow[]; changed: boolean } {
    const entries = normalizeEntries(stored, rules);
    const present = new Set(entries.map((entry) => entry.id));
    const cap = rules.cap === void 0 ? ENTRY_CAP : rules.cap;
    const merged = entries.slice();
    for (const id of ids) {
        if (merged.length >= cap) break;
        const trimmed = typeof id === "string" ? id.trim() : "";
        if (!isValidEntryId(trimmed, rules) || present.has(trimmed)) continue;
        present.add(trimmed);
        merged.push({ id: trimmed, name: "" });
    }
    return { entries: merged, changed: JSON.stringify(merged) !== JSON.stringify(entries) };
}

/** The ids a catalog currently carries, in row order. */
export function entryIds(entries: readonly CatalogRow[] | undefined): string[] {
    return (entries === void 0 ? [] : entries).map((entry) => entry.id);
}

/** One row lookup by id (`undefined` when absent). */
export function findEntry(
    entries: readonly CatalogRow[],
    id: string
): CatalogRow | undefined {
    return entries.find((entry) => entry.id === id);
}
