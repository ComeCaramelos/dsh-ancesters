/**
 * A global registry keyed by `Symbol.for(...)` (H5) — the machinery behind any
 * "N things plus a plug-in resolver" seam.
 *
 * The registry has to be **global**, not module-scoped: two dependency trees
 * of the same package (one installed as a sibling, one pulled in by a
 * companion) must see the *same* map, or a companion's registration lands in a
 * map nobody reads and its entry silently never runs. `Symbol.for` is how the
 * package guarantees that identity across trees, so this is the one place that
 * touches `globalThis`.
 *
 * Three details belong to the mechanism, not to any consumer:
 *
 *   * insertion order is the answer order (a card renders what it was told,
 *     not whatever the engine happened to iterate);
 *   * registrations **stack**: registering an id that is already registered
 *     replaces it, and disposing a registration gives the older one back. A
 *     disposer is idempotent by **identity**, not by id, so the older owner's
 *     cleanup can never erase a newer answer;
 *   * resolving something that is not there answers a *reason*, never a
 *     default. Falling back to a default is exactly how an unregistered thing
 *     starts running (the manager's rule: an unknown kind must never resolve
 *     as `stdio`).
 */

/** What resolving one id answers: the entry, or the reason there is none. */
export interface RegistryAnswer<T> {
    entry?: T;
    /** What the consumer puts on the line — never an exception. */
    answer: unknown;
}

/** The registry surface one seam builds on. */
export interface GlobalRegistry<T> {
    /**
     * Register (or replace) one id.
     * @returns a disposer removing **this** registration only, giving back the
     * registration it replaced; idempotent.
     */
    register(id: string, entry: T): () => void;
    /** Every entry, in registration order. */
    list(): readonly T[];
    /** Every id, in registration order. */
    ids(): readonly string[];
    /** One entry by id, `undefined` when nothing carries it. */
    get(id: string): T | undefined;
    /** Resolve one id. Absent ⇒ `missing(id)`, never a silent default. */
    resolve(id: string, missing?: (id: string) => unknown): RegistryAnswer<T>;
}

/** Registration stacks, shared under one global key. */
type Stacks<T> = Map<string, T[]>;

/**
 * A key that cannot collide with another package's map.
 *
 * The whole promise of this module is that two dependency trees of the same
 * package read *one* map — which also means a bare `"kinds"` would share a map
 * with anything else standing under that word. A `Symbol` is namespaced by
 * construction; a string key has to carry its package, so a plain word is
 * refused here rather than debugging two cards that quietly see each other.
 */
function namespacedKey(key: string | symbol): string | symbol {
    if (typeof key === "symbol") return key;
    if (typeof key !== "string" || key.trim() === "" || !key.includes("/")) {
        throw new TypeError(
            `createGlobalRegistry: the map needs a namespaced identity — Symbol.for("<package>/what") or "<package>/what" (got ${key === "" ? "an empty string" : typeof key === "string" ? `"${key}"` : typeof key})`
        );
    }
    return key;
}

/** A registry shared by every copy of the same package under one key. */
function shared<T>(key: string | symbol): Stacks<T> {
    const holder = globalThis as unknown as Partial<Record<string | symbol, Stacks<T>>>;
    let stacks = holder[key];
    if (stacks === undefined) {
        stacks = new Map<string, T[]>();
        holder[key] = stacks;
    }
    return stacks;
}

/**
 * Stand a registry on a global key.
 * @param key - the identity of the map: `Symbol.for("<package>/what")`, or a
 * namespaced string. A bare word throws (`namespacedKey`).
 */
export function createGlobalRegistry<T>(key: string | symbol): GlobalRegistry<T> {
    const stacks = shared<T>(namespacedKey(key));

    /** What one id currently answers — the top of its stack. */
    const current = (id: string): T | undefined => {
        const stack = stacks.get(id);
        return stack === undefined ? void 0 : stack[stack.length - 1];
    };

    const register = (id: string, entry: T): (() => void) => {
        if (typeof id !== "string" || id === "") {
            throw new TypeError(`register: an entry needs a non-empty id (got ${typeof id})`);
        }
        if (entry === void 0 || entry === null) {
            throw new TypeError(`register(${id}): requires an entry (undefined answers nothing)`);
        }
        let stack = stacks.get(id);
        if (stack === undefined) {
            stack = [];
            stacks.set(id, stack);
        }
        stack.push(entry);

        let done = false;
        return () => {
            // Identity, not id: whatever stands under it, or over it, is nobody
            // else's to undo.
            if (done) return;
            const live = stacks.get(id);
            if (live === undefined) return;
            const at = live.indexOf(entry);
            if (at < 0) return;
            done = true;
            live.splice(at, 1);
            if (live.length === 0) stacks.delete(id);
        };
    };

    const ids = (): readonly string[] => [...stacks.keys()];
    const list = (): readonly T[] => [...stacks.keys()].map((id) => current(id) as T);
    const get = (id: string): T | undefined => current(id);
    const resolve = (id: string, missing?: (id: string) => unknown): RegistryAnswer<T> => {
        const entry = current(id);
        if (entry !== void 0) return { entry, answer: entry };
        const answer = typeof missing === "function" ? missing(id) : `nothing is registered under "${id}"`;
        return { answer };
    };

    return { register, list, ids, get, resolve };
}
