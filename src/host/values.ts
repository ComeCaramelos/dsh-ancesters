/**
 * Value comparison — the diff primitive every consumer needs and no consumer
 * should rewrite.
 *
 * A consumer that canonized a map by hand (sorting keys before stringifying)
 * and `client/controller`'s `JSON.stringify(a) === JSON.stringify(b)` compare
 * the same thing two different ways, and the second **is** sensitive to key
 * order: a host that re-serializes a map with its keys in another order shows
 * the card a field that never changed. One primitive, used by both halves.
 *
 * The rules are the whole point, so no consumer can drift them:
 *
 *   * a key carrying no value — `undefined`, `null`, or standing nowhere at
 *     all — is the same answer everywhere: one unset field, one rule, and
 *     never a reason to restart;
 *   * objects compare **by key**, never by insertion order;
 *   * arrays keep their order (an argument list is a list, not a set);
 *   * a value that is not a plain map or a list (`Date`, `RegExp`, `Map`,
 *     `Set`) compares by **what it is**. Reading one as `Object.keys`-empty
 *     would call every pair of them equal, and a config carrying a date would
 *     never read as moved;
 *   * *who built it* is never part of the comparison: the loader evaluates its
 *     blocks in their own realm, and `instanceof` / `=== Object.prototype` only
 *     speak about **this** one — a foreign-built map read as a record with no
 *     keys would look unchanged forever.
 *
 * Both halves read this one module: `host/pool.ts` diffs resolved configs with
 * it, and the browser controller stages its fields with it. It is pure on
 * purpose (no `node:` imports) so the browser bundle can carry the same code.
 */

/** How a value is tagged, across realms (`[object Date]` → `"Date"`).
 *
 * `instanceof` and `=== Object.prototype` only speak about **this** realm: a map
 * or a record that reached us from the realm the loader runs its blocks in would
 * read as neither, and a diff would call it moved. The tag is what the object
 * says about itself, in any realm. */
function tag(value: unknown): string {
    return Object.prototype.toString.call(value).slice(8, -1);
}

/** Whether one value is a plain map: an object literal, or a prototype-less one.
 * Exported because "is this a *record* or a *thing*" answers that for both
 * halves (`sameValue`, and the copy one read makes of a live reference). */
export function isPlainObject(value: object): boolean {
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype === null) return true;
    if (prototype === Object.prototype) return true;
    // The chain of a plain object is `value → Object.prototype → nothing`, and
    // that shape says "plain" wherever the object was built (`tag` would answer
    // "Object" for anything not built by a class — hence the two tests).
    return Object.getPrototypeOf(prototype) === null && tag(value) === "Object";
}

/** The canonical shape of a `Map`/`Set`, so a walk and a serialization agree.
 * Keyless `Map` entries and unorderable `Set` members are sorted by their own
 * canonical text: neither one carries an insertion order that means anything. */
function canonicalCollection(value: ReadonlyMap<unknown, unknown> | ReadonlySet<unknown>, kind: string): unknown {
    if (kind === "Set") {
        return [...(value as ReadonlySet<unknown>)].map(canonical).sort((left, right) => stableKey(left) < stableKey(right) ? -1 : 1);
    }
    return [...(value as ReadonlyMap<unknown, unknown>)]
        .map(([key, item]) => [canonical(key), canonical(item)])
        .sort((left, right) => stableKey(left[0]) < stableKey(right[0]) ? -1 : 1);
}

/** A key that answers nothing: unset or `null` — both primitives read that as
 * the same answer, so a field that went unset never reads as a drift. */
function answersNothing(value: unknown): boolean {
    return value === void 0 || value === null;
}

/** The keys that do answer — what a diff compares, in both primitives. */
function meaningfulKeys(value: object): string[] {
    return Object.keys(value).filter((key) => !answersNothing((value as Record<string, unknown>)[key]));
}

/** A `Map`/`Set`'s canonical form: pairs/members, never the `{}` JSON gives it. */
function canonical(value: unknown): unknown {
    const kind = tag(value);
    if (kind === "Set" || kind === "Map") return canonicalCollection(value as ReadonlyMap<unknown, unknown> | ReadonlySet<unknown>, kind);
    return value;
}

/** Canonical, order-insensitive key for `value`: object keys sorted, arrays in
 * order, `undefined` landed as `null`, `Map`/`Set` in their canonical pair list
 * (never `{}`, which would make them look empty). Stable across runs/processes. */
export function stableKey(value: unknown): string {
    const text = JSON.stringify(value, (_key, item: unknown) => {
        if (item !== null && typeof item === "object") {
            const kind = tag(item);
            if (kind === "Set" || kind === "Map") return canonicalCollection(item as ReadonlyMap<unknown, unknown> | ReadonlySet<unknown>, kind);
        }
        if (item !== null && typeof item === "object" && !Array.isArray(item)) {
            const sorted: Record<string, unknown> = {};
            for (const name of Object.keys(item as Record<string, unknown>).sort()) {
                const child = (item as Record<string, unknown>)[name];
                // A key answering nothing is not a key: unset, `null` and
                // absent are one answer, the same one rule both primitives use.
                if (!answersNothing(child)) sorted[name] = child;
            }
            return sorted;
        }
        return item === void 0 ? null : item;
    });
    return text === undefined ? "null" : text;
}

/**
 * Whether `a` and `b` carry the same value.
 *
 * Same rules as {@link stableKey} (key order irrelevant, array order relevant,
 * one rule for what counts as a key at all), expressed as a walk rather than a
 * serialization so a large config never pays for a string it will throw away.
 */
export function sameValue(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a === "number" && typeof b === "number") return Number.isNaN(a) && Number.isNaN(b);
    // An unset field, a field set to `null` and a field that stands nowhere are
    // one answer to a diff — the rule `stableKey` follows by not serializing it.
    const leftMissing = answersNothing(a);
    const rightMissing = answersNothing(b);
    if (leftMissing || rightMissing) return leftMissing && rightMissing;
    if (typeof a !== "object" || typeof b !== "object") return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        return a.every((item, index) => sameValue(item, b[index]));
    }
    // A `Date`, `RegExp`, `Map` or `Set` answers nothing through `Object.keys`,
    // so comparing them as maps would read any two of them as the same value —
    // and a config carrying one would never look like it moved.
    if (!isPlainObject(a as object) || !isPlainObject(b as object)) return sameOpaqueValue(a, b);
    const left = meaningfulKeys(a as object);
    const right = meaningfulKeys(b as object);
    if (left.length !== right.length) return false;
    return left.every(
        (key) =>
            Object.prototype.hasOwnProperty.call(b, key) &&
            sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
    );
}

/**
 * Compare one value that is not a plain map or a list.
 *
 * A `Date` answers by its instant, a `RegExp` by source and flags, a `Map` or a
 * `Set` by its canonical pair list (unordered, so neither insertion order nor
 * key order means anything), and a boxed primitive by its own value. Anything
 * else answers `false`: an unknown shape is a change, never an accident that
 * reads as nothing.
 */
function sameOpaqueValue(a: unknown, b: unknown): boolean {
    const kind = tag(a);
    if (kind !== tag(b)) return false;
    if (kind === "Date") return sameValue((a as Date).getTime(), (b as Date).getTime());
    if (kind === "RegExp") {
        return sameValue((a as RegExp).source, (b as RegExp).source) &&
            sameValue((a as RegExp).flags, (b as RegExp).flags);
    }
    if (kind === "Map" || kind === "Set") {
        return sameValue(canonical(a), canonical(b));
    }
    if (kind === "String" || kind === "Number" || kind === "Boolean") {
        return sameValue((a as { valueOf(): unknown }).valueOf(), (b as { valueOf(): unknown }).valueOf());
    }
    return false;
}
