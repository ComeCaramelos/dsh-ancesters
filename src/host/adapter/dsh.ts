/**
 * Structural views of the dsh services the adapter layer talks to.
 *
 * The services live in the running host's module table, never in a local
 * `node_modules` tree, so they are described here (the same idiom the client
 * half uses for the shell primitives). `test/compat.test.mjs` pins the shape
 * checks: a surface that exists but answers with the wrong shape must fail
 * loudly with a named error, not silently default.
 */
import { isPlainObject } from "../values.js";

/** One configuration-document write op (`settings.mutate`). */
export type SettingsPathOp =
    | { op: "set"; path: readonly string[]; value: unknown }
    | { op: "unset"; path: readonly string[] };

/** One described configuration document. Only `entryId`/`revision`/layers
 * matter to the adapter; everything else stays opaque. */
export interface SettingsDocument {
    entryId?: string;
    revision?: number;
    user?: unknown;
    base?: unknown;
    [key: string]: unknown;
}

/** The settings service, narrowed to the calls `ancesters` ever makes. */
export interface SettingsForms {
    /** Every document the running host currently describes. */
    describe(options?: unknown): SettingsDocument[];
    /** Turn the generated configuration page off (the card owns the row's
     * page). A *disposable* call: a second `configure` for one fiber throws. */
    configure(presentation: { auto?: boolean }, owner?: unknown): () => void;
    /** Write one entry's stored layer through ops (no revision argument). */
    mutate(entryId: string, ops: readonly SettingsPathOp[]): Promise<unknown> | unknown;
}

/** Whether one service value is *this* surface, by shape — never by version
 * string (contratos-dsh §9: feature-detect the surface, never the number). */
export function supportsSettingsForms(service: unknown): service is SettingsForms {
    if (typeof service !== "object" || service === null) return false;
    const candidate = service as Record<string, unknown>;
    return typeof candidate.describe === "function" &&
        typeof candidate.configure === "function" &&
        typeof candidate.mutate === "function";
}

/**
 * Answer with the service, or fail loud — "this dsh build is not supported"
 * rather than a silent default on a half-shaped surface.
 */
export function requireSettingsForms(service: unknown): SettingsForms {
    if (!supportsSettingsForms(service)) {
        throw new TypeError(
            "this dsh build is not supported: the `settings` service does not answer the `describe`/`configure`/`mutate` surface (contratos-dsh §9; dsh-ancesters hosts >=0.2.0 <0.3.0)"
        );
    }
    return service;
}

/** What a fiber's own loader entry answers. */
export interface EntryLike {
    options?: { id?: unknown; config?: Record<string, unknown> };
    /** A volatile config commit must not restart or recreate the entry. */
    update(options: Record<string, unknown>, create?: boolean, force?: boolean): Promise<unknown> | unknown;
}

/** Only what the live publisher reads off the fiber. ACTIVE = 2. */
export interface FiberLike {
    state?: number;
    entry?: EntryLike;
    /** Resolves once the fiber settles into a stable state. */
    await?(): Promise<unknown>;
}

/** FiberState.ACTIVE — a volatile commit only lands in the running references
 * while the load has settled. */
export const FIBER_ACTIVE = 2;

/**
 * The plugin context, narrowed to exactly what the adapter touches. The real
 * `PluginContext` satisfies it structurally; tests provide it themselves, so
 * no test ever stands up a real plugin host.
 */
export interface AdapterContext {
    fiber?: unknown;
    effect<T>(setup: () => (() => void) | void, name?: string): void;
    inject?(names: readonly string[], callback: (inner: AdapterContext) => void): void;
    get?(name: string): unknown;
    on?(event: string, handler: (...args: any[]) => unknown): void | (() => void);
    logger?: { error(...args: unknown[]): void; warn(...args: unknown[]): void; info(...args: unknown[]): void };
}

/** The volatile-update event name the loader reports commits under. */
export const VOLATILE_UPDATE_EVENT = "loader/volatile-update";

/** The tool-execution event name the tool surface reports results under. */
export const TOOL_POST_EXECUTE_EVENT = "tools/post-execute";

/** The adapter's own logger calls answer under this prefix. */
export function logPrefix(name: string | undefined): string {
    return name === undefined || name === "" ? "dsh-ancesters" : `dsh-ancesters(${name})`;
}

/** One logger call, so the adapter never depends on the concrete logger. */
export function log(
    ctx: AdapterContext,
    level: "error" | "warn" | "info",
    name: string | undefined,
    message: string
): void {
    const logger = ctx.logger;
    if (logger !== void 0 && typeof logger[level] === "function") logger[level](`${logPrefix(name)}: ${message}`);
}

/**
 * The current value of one `.volatile()` field, whichever way it reached us.
 *
 * cordis hands every `.volatile()` field of a profile row to `apply` as a
 * **live reference** (`{ get() }`) — that is how a commit lands without
 * remounting the fiber — while a config built by hand (a test, or a bare
 * `ctx.plugin()` mount that is not a profile entry) hands the plain value
 * instead. One read path for both shapes, so a consumer never writes the
 * branch again; it lives here because the difference is a dsh surface, and the
 * layering rule lets only the adapter touch one (`test/surface.test.mjs`).
 *
 * A read hands back what the row **answered**, not the row's own standing
 * reference: every container it meets is copied (a list, a map, a `Map` or a
 * `Set`), so sorting, filtering or writing to what one holds never reaches the
 * row through the back door. A leaf — a function, a class instance, whatever
 * else — is handed over as it stands, because copying that would be a surprise.
 *
 * A reference whose `get()` throws answers the fallback rather than taking a
 * reconcile down with it — the row is never the reader's fault.
 */
export function readVolatile<T>(field: unknown, fallback: T): T {
    if (field === void 0 || field === null) return fallback;
    const holder = field as { get?: () => unknown };
    if (typeof holder.get === "function") {
        let value: unknown;
        try {
            value = holder.get();
        } catch {
            return fallback;
        }
        return copyHeld(value, fallback);
    }
    return copyHeld(field, fallback);
}

/** The containers one read met, copied; the leaves it met, left standing. */
function copyHeld<T>(value: unknown, fallback: T): T {
    if (value === void 0 || value === null) return fallback;
    if (Array.isArray(value)) return value.map((item) => copyHeld(item, item)) as unknown as T;
    if (value instanceof Map) return new Map([...value].map(([key, item]) => [key, copyHeld(item, item)])) as unknown as T;
    if (value instanceof Set) return new Set([...value].map((item) => copyHeld(item, item))) as unknown as T;
    if (typeof value === "object" && isPlainObject(value as object)) {
        const copy: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
            if (item === void 0 || item === null) continue;
            copy[key] = copyHeld(item, item);
        }
        return copy as unknown as T;
    }
    return value as T;
}
