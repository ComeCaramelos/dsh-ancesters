/**
 * Fiber pool — N live child fibers behind one list field (H1).
 *
 * `createRunChain` serializes runs; this keeps fibers. A profile row that means
 * "one live thing per entry of this list" — connections, relays, workers — has
 * to reconcile a list against a map of running things, and that diff is the
 * same code every time: keyed map, diff, start, switch in place, dispose,
 * contain the first failure, and never leave a dead key behind when the effect
 * ends. This module owns that; what a fiber *means* is the consumer's, through
 * three holes and one rule.
 *
 * What the pool fixes (it is behaviour, not implementation detail):
 *
 *   1. `reconcile()` is the only place a fiber is started, switched or stopped,
 *      and it runs after every commit that names a user field. Nothing else may
 *      start a fiber behind the pool's back.
 *   2. The diff is decided over what `resolve()` answered — never over the
 *      entry. A field the resolver never uses must not bounce something alive.
 *   3. A fiber whose first connect fails keeps **its own line**, carrying its
 *      error, and everything else stays live. A row never fails because one of
 *      its keys did.
 *   4. `disposed` is the guard in front of every delayed answer: a promise that
 *      lands after `dispose()` never writes on a line again.
 *   5. A line keeps its own state across reconciles. `reconcile()` never decides
 *      by itself that something is connected — only the first connect (or a
 *      `mark`) says that.
 *
 * Nothing here knows about connections, kinds or any transport library: the
 * pool speaks `entries`, `id`, `enabled`, `resolve`, `start`, and lines.
 */
import type { AdapterContext } from "./adapter/dsh.js";
import { log } from "./adapter/dsh.js";
import { sameValue, stableKey } from "./values.js";

/** One live fiber, narrowed to what the pool drives. */
export interface PoolFiber {
    /** Switch in place — the pool calls this when the resolved config moved. */
    update(config: unknown): unknown;
    /** Stop it for good. */
    dispose(): unknown;
    /** `then`able: waiting for a fiber is waiting for its first connect. */
    then?(onFulfilled: () => unknown, onRejected: (error: unknown) => unknown): unknown;
    /** Wait for its current lifecycle work (cordis `Fiber.await`): after an
     * `update`, the restart behind it — `update` itself returns before that. */
    await?(): unknown;
}

/** What one keyed entry is answering, mirrored for the UI. */
export interface PoolLine<E = unknown> {
    /** The key the entry claims. */
    id: string;
    /**
     * `off` when `enabled` denied it, `starting` while the pool waits for the
     * first connect, `connected` once that answered, `failed` when its first
     * connect threw, when `start` itself threw, when that connect stood
     * unresolved past `firstConnectMs`, or when the line says so, and
     * `conflict` when the key is already claimed by a live sibling.
     */
    state: "off" | "starting" | "connected" | "failed" | "conflict";
    /** A line for the user — never an exception. */
    error: string;
    /** A diagnostic that is never a failure (where stderr went, say). */
    note: string;
    /** Whatever else this key publishes (names, paths…), kept across publishes
     * by the pool so a reconcile that changes nothing never erases it. */
    extras?: Record<string, unknown>;
    /** The entry this line came from, when the pool still holds it. */
    entry?: E;
}

/** What a consumer answers through the three holes. */
export interface FiberPoolSpec<E> {
    /** What the row says right now — re-read on every reconcile. */
    entries(): readonly E[];
    /** Stable identity: the map key, and the namespace it reserves. */
    id(entry: E): string;
    /** Whether it should run. A false stops it and mirrors `off`. */
    enabled(entry: E): boolean;
    /**
     * What actually runs. `error` is a line, never a throw.
     *
     * May answer a promise when the answer needs preparing first (a daemon to
     * wait for, a browser to launch, a list to discover). While it is pending
     * the key reads `starting` — and a fiber it already had keeps running what
     * it ran — and once it lands the pool reconciles again. A prepared answer
     * is kept for as long as the entry stands unchanged (`stableKey`), so a
     * reconcile that changes nothing never prepares twice; turning the entry
     * off, removing it or {@link FiberPool.invalidate} forgets it. A promise
     * that rejects answers that key's `failed` line.
     */
    resolve(entry: E): ResolvedEntry | PromiseLike<ResolvedEntry>;
    /** What the diff compares; by default the whole resolved config. */
    diff?(entry: E, resolved: unknown): unknown;
    /** Start the fiber — `ctx.plugin(Child, cfg)` for the usual case. */
    start(config: unknown, entry: E): PoolFiber;
    /** What to do with the lines: the usual answer is mirror them. */
    publish?(lines: readonly PoolLine<E>[]): void;
    /** A logger call, already prefixed. */
    log?(level: "info" | "warn", message: string): void;
    /** Prefix every log line carries: `<prefix>` or `<prefix>(<id>)`. */
    prefix?: string;
    /** Ceiling on live keys; the ones past it mirror `failed` without starting.
     * Counted against what this reconcile leaves live — entries the row no
     * longer names do not spend a slot on their way out. */
    cap?: number;
    /** Ceiling on how long a first connect may stand unanswered: past it the
     * line reads `failed`, because a fiber that never answered is not live.
     * Without it a connect that hangs stays `starting` forever. */
    firstConnectMs?: number;
    /** Ceiling on how long an asynchronous `resolve` may stand unanswered:
     * past it the key reads `failed`, and a late answer is dropped. The
     * first-connect deadline only starts once a fiber does. */
    resolveMs?: number;
    /**
     * Identity rule read **before** any fiber starts, because everything below
     * a bad key is built on top of it: an entry that cannot claim a key gets a
     * line and no bridge. `state` lets the rule answer `conflict` rather than
     * a plain `failed` (two entries claiming one key is a different problem).
     */
    validate?(entry: E, context: { index: number; ids: readonly string[] }): { error?: string; state?: PoolLine<E>["state"] } | undefined;
}

/** The pool surface a consumer holds. */
export interface FiberPool<E> {
    /** Fold the row into the live fibers; answers what moved. */
    reconcile(): { started: number; updated: number; stopped: number; errors: string[] };
    /** Re-read the row and reconcile — what a user-field commit fires. */
    refresh(): void;
    /** Stop every live fiber. Goes in the effect's disposer. */
    dispose(): void;
    /** The per-key mirror, in entry order. */
    live(): readonly PoolLine<E>[];
    /**
     * Fold a delayed answer into one key's line: a first connect that landed,
     * or what that key is actually publishing. Answers `false` when no line
     * carries that key any more — a late answer for a removed entry.
     */
    mark(id: string, patch: Partial<Omit<PoolLine<E>, "id">>): boolean;
    /**
     * Forget what one key prepared (or is preparing) and reconcile, so its
     * `resolve` runs again even though the entry did not change — a "launch it
     * again" action. A late answer of the forgotten preparation is dropped.
     */
    invalidate(id: string): void;
}

/** What `resolve` answers for one entry. */
export interface ResolvedEntry {
    config?: unknown;
    error?: string;
    note?: string;
}

/** One asynchronous preparation in flight for one key. */
interface Preparation {
    /** The entry it was asked for, as `stableKey` reads it. */
    key: string;
    timer?: ReturnType<typeof setTimeout>;
}

/** True for anything with a `then` — what a resolver answers to prepare first. */
function isThenable(value: unknown): value is PromiseLike<ResolvedEntry> {
    return value !== null && (typeof value === "object" || typeof value === "function") && typeof (value as { then?: unknown }).then === "function";
}

/** One live key, and the exact config its fiber runs. */
interface Handle<E> {
    /** Always a fiber — a `start` that threw leaves no handle behind. */
    fiber: PoolFiber;
    config: unknown;
    entry: E;
    note: string;
    /** Armed only when `firstConnectMs` stands; cleared the moment the first
     * connect answers, the handle stops, or the pool is disposed. */
    deadline?: ReturnType<typeof setTimeout>;
    /** Whether what the fiber runs now has connected — what a key answers
     * again when a re-preparation lands on the config it already runs. */
    connected?: boolean;
}

/** Clear one handle's pending first-connect deadline. */
function clearDeadline<E>(handle: Handle<E> | undefined): void {
    if (handle?.deadline !== void 0) clearTimeout(handle.deadline);
}

/**
 * Stand a fiber pool over one context and one spec.
 */
export function createFiberPool<E>(ctx: AdapterContext, spec: FiberPoolSpec<E>): FiberPool<E> {
    const handles = new Map<string, Handle<E>>();
    const lines = new Map<string, PoolLine<E>>();
    /** Asynchronous preparations in flight, one per key at most. */
    const preparing = new Map<string, Preparation>();
    /** Asynchronous answers that landed, kept while their entry stands. */
    const prepared = new Map<string, { key: string; answer: ResolvedEntry }>();
    let disposed = false;

    /**
     * Every log line carries the pool's own prefix, keyed when it is about one.
     *
     * A pool that names no logger is not a pool that says nothing: the lines
     * stand behind the context it was stood up against, which is exactly why the
     * context is here at all.
     */
    const say = (level: "info" | "warn", id: string | undefined, message: string): void => {
        const head = spec.prefix === undefined ? (id === undefined ? "" : `(${id}): `) : `${spec.prefix}${id === undefined ? "" : `(${id})`}: `;
        if (typeof spec.log === "function") {
            spec.log(level, `${head}${message}`);
            return;
        }
        // The same line, so a consumer that never named a logger still hears
        // what the pool says about its keys — named by the pool's own prefix.
        log(ctx, level, spec.prefix, id === undefined ? message : `(${id}): ${message}`);
    };

    const stop = (handle: Handle<E> | undefined, id: string, why: string): boolean => {
        if (handle === undefined) return false;
        clearDeadline(handle);
        handles.delete(id);
        void Promise.resolve(handle.fiber.dispose()).catch((error: unknown) =>
            say("warn", id, `fiber shutdown failed: ${String(error)}`));
        if (why !== "") say("info", id, `stopped (${why})`);
        return true;
    };

    /** Stand one fiber up. A `start` that throws answers a **line** and no
     * handle: a half-born handle would be taken on the next reconcile for a
     * live key that never started, so the failure would never be retried. */
    const start = (entry: E, id: string, config: unknown, note: string): { handle?: Handle<E>; error?: string } => {
        let fiber: PoolFiber;
        try {
            fiber = spec.start(config, entry);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            say("warn", id, `could not start: ${message}`);
            return { error: message };
        }
        const handle: Handle<E> = { fiber, config, entry, note };
        // The first connect is the only answer that says a fiber is really
        // alive, so it lands on this key's line — never as a row failure.
        const settle = (line: Partial<PoolLine<E>>): void => {
            clearDeadline(handle);
            if (disposed || handles.get(id) !== handle) return;
            mark(id, line);
        };
        const deadlineMs = typeof spec.firstConnectMs === "number" && spec.firstConnectMs > 0 ? spec.firstConnectMs : 0;
        if (deadlineMs > 0) {
            handle.deadline = setTimeout(() => {
                handle.deadline = void 0;
                if (disposed || handles.get(id) !== handle) return;
                const message = `the first connect did not answer within ${String(deadlineMs)}ms`;
                say("warn", id, message);
                mark(id, { state: "failed", error: message });
            }, deadlineMs);
        }
        Promise.resolve(fiber as unknown).then(
            () => {
                handle.connected = true;
                settle({ state: "connected", error: "" });
            },
            (error: unknown) => {
                const message = error instanceof Error ? error.message : String(error);
                say("warn", id, `first connect failed: ${message}`);
                handle.connected = false;
                settle({ state: "failed", error: message });
            }
        );
        say("info", id, "started");
        return { handle };
    };

    /** Drop what one key prepared or is preparing; a late answer finds nothing. */
    const forget = (id: string): void => {
        const pending = preparing.get(id);
        if (pending?.timer !== void 0) clearTimeout(pending.timer);
        preparing.delete(id);
        prepared.delete(id);
    };

    /**
     * Answer one entry through `resolve`, or say it is still preparing.
     *
     * A synchronous answer is used as it comes, every reconcile, exactly as
     * before. A promise is asked once per entry state: it parks the key, and
     * the answer it lands with is kept and folded in by the reconcile it
     * triggers — unless something newer replaced it, in which case it is
     * dropped on arrival.
     */
    const resolveEntry = (entry: E, id: string): ResolvedEntry | "preparing" => {
        const key = stableKey(entry);
        const kept = prepared.get(id);
        if (kept !== void 0 && kept.key === key) return kept.answer;
        const pending = preparing.get(id);
        if (pending !== void 0 && pending.key === key) return "preparing";

        let answer: ResolvedEntry | PromiseLike<ResolvedEntry>;
        try {
            answer = spec.resolve(entry);
        } catch (error) {
            return { error: error instanceof Error ? error.message : String(error) };
        }
        if (!isThenable(answer)) {
            prepared.delete(id);
            return answer ?? {};
        }

        forget(id);
        const preparation: Preparation = { key };
        preparing.set(id, preparation);
        const land = (landed: ResolvedEntry): void => {
            if (disposed || preparing.get(id) !== preparation) return;
            if (preparation.timer !== void 0) clearTimeout(preparation.timer);
            preparing.delete(id);
            prepared.set(id, { key, answer: landed });
            reconcile();
        };
        const deadlineMs = typeof spec.resolveMs === "number" && spec.resolveMs > 0 ? spec.resolveMs : 0;
        if (deadlineMs > 0) {
            preparation.timer = setTimeout(() => {
                preparation.timer = void 0;
                land({ error: `preparing this entry did not answer within ${String(deadlineMs)}ms` });
            }, deadlineMs);
        }
        Promise.resolve(answer).then(
            (landed) => land(landed ?? {}),
            (error: unknown) => land({ error: error instanceof Error ? error.message : String(error) })
        );
        say("info", id, "preparing");
        return "preparing";
    };

    const diffOf = (entry: E, config: unknown): unknown =>
        typeof spec.diff === "function" ? spec.diff(entry, config) : config;

    const publish = (): void => {
        if (disposed) return;
        spec.publish?.([...lines.values()]);
    };

    const mark = (id: string, patch: Partial<Omit<PoolLine<E>, "id">>): boolean => {
        if (disposed) return false;
        const line = lines.get(id);
        if (line === void 0) return false;
        const extras = patch.extras === void 0 ? line.extras : { ...(line.extras ?? {}), ...patch.extras };
        const next: PoolLine<E> = { ...line, ...patch, id, ...(extras === void 0 ? {} : { extras }) };
        if (sameValue(line, next)) return true;
        lines.set(id, next);
        publish();
        return true;
    };

    const reconcile = (): { started: number; updated: number; stopped: number; errors: string[] } => {
        const report = { started: 0, updated: 0, stopped: 0, errors: [] as string[] };
        if (disposed) return report;

        const entries = [...(spec.entries() ?? [])];
        const ids = entries.map((entry) => spec.id(entry));
        const nextHandles = new Map<string, Handle<E>>();
        const nextLines = new Map<string, PoolLine<E>>();
        const claimed = new Set<string>();
        // Live keys as this reconcile leaves them. Counted against this, not
        // against `handles`, because the keys the row dropped only stop being
        // live further down: counting them would spend the ceiling on their way
        // out and refuse every replacement the row asked for.
        let live = 0;
        /** Keys this reconcile stands a live fiber behind — what a duplicate
         * claim may not disturb. */
        const liveClaims = new Set<string>();

        // Identity first, because everything below a key that cannot exist is
        // built on it: an unusable key answers a line and starts nothing.
        entries.forEach((entry, index) => {
            const id = spec.id(entry);
            const previous = handles.get(id);
            const previousLine = lines.get(id);
            const carry = { ...(previousLine?.extras === void 0 ? {} : { extras: previousLine.extras }), entry };

            if (typeof spec.validate === "function") {
                const invalid = spec.validate(entry, { index, ids });
                if (invalid?.error !== void 0) {
                    forget(id);
                    nextLines.set(id, { id, state: invalid.state ?? "failed", error: invalid.error, note: "", ...carry });
                    report.errors.push(invalid.error);
                    say("warn", id, invalid.error);
                    report.stopped += stop(previous, id, "") ? 1 : 0;
                    return;
                }
            }

            if (claimed.has(id)) {
                // Two entries claiming one namespace is a conflict the resolver
                // cannot be allowed to paper over. The first live claimant keeps
                // its fiber and its line: a duplicate in the row is the second
                // entry's problem, never an excuse to go dark.
                const error = `"${id}" is already claimed by another live entry`;
                report.errors.push(error);
                say("warn", id, error);
                if (!liveClaims.has(id)) nextLines.set(id, { id, state: "conflict", error, note: "", ...carry });
                return;
            }
            claimed.add(id);

            if (!spec.enabled(entry)) {
                // Off forgets what it prepared: turning it on again prepares
                // again (a browser to relaunch, a daemon to wait for).
                forget(id);
                nextLines.set(id, { id, state: "off", error: "", note: "", ...carry });
                report.stopped += stop(previous, id, "") ? 1 : 0;
                return;
            }

            const answered = resolveEntry(entry, id);
            if (answered === "preparing") {
                // Nothing to start or switch yet. A fiber this key already had
                // keeps running what it ran until the new answer lands.
                if (previous !== void 0) {
                    nextHandles.set(id, previous);
                    live++;
                    liveClaims.add(id);
                }
                nextLines.set(id, { id, state: "starting", error: "", note: previousLine?.note ?? "", ...carry });
                return;
            }
            const resolved = answered;
            const note = resolved.note ?? "";
            if (resolved.config === void 0) {
                const error = resolved.error ?? "this entry resolved nothing";
                nextLines.set(id, { id, state: "failed", error, note, ...carry });
                report.errors.push(error);
                say("warn", id, error);
                report.stopped += stop(previous, id, "") ? 1 : 0;
                return;
            }

            if (previous === void 0) {
                if (spec.cap !== void 0 && live >= spec.cap) {
                    const error = `the ceiling of ${String(spec.cap)} live entries is reached`;
                    nextLines.set(id, { id, state: "failed", error, note, ...carry });
                    report.errors.push(error);
                    say("warn", id, error);
                    return;
                }
                const began = start(entry, id, resolved.config, note);
                if (began.handle === void 0) {
                    // Nothing stands behind this key. It answers the reason and
                    // stays unstarted, so the next reconcile gets another try
                    // instead of carrying a handle that never was a fiber.
                    const error = began.error ?? "this entry never started";
                    nextLines.set(id, { id, state: "failed", error, note, ...carry });
                    report.errors.push(error);
                    return;
                }
                nextHandles.set(id, began.handle);
                handles.set(id, began.handle);
                live++;
                liveClaims.add(id);
                nextLines.set(id, { id, state: "starting", error: "", note, ...carry });
                report.started++;
                return;
            }

            nextHandles.set(id, previous);
            live++;
            liveClaims.add(id);
            previous.note = note;
            if (!sameValue(diffOf(previous.entry, previous.config), diffOf(entry, resolved.config))) {
                say("info", id, "switching in place (its resolved configuration moved)");
                previous.connected = false;
                Promise.resolve(previous.fiber.update(resolved.config)).then(
                    () => {
                        previous.config = resolved.config;
                        previous.entry = entry;
                        mark(id, { state: "starting", note });
                        // The switch restarted what the fiber runs: like a first
                        // start, only its connect says it is live again — unless
                        // a newer switch or a stop took this key meanwhile.
                        const current = resolved.config;
                        const still = (): boolean => !disposed && handles.get(id) === previous && previous.config === current;
                        // cordis runs the restart behind `update` without
                        // returning it: `await()` is what waits for it (a
                        // thenable alone would answer before the restart did).
                        const fiber = previous.fiber;
                        const restarted: unknown = typeof fiber.await === "function" ? fiber.await() : fiber;
                        Promise.resolve(restarted).then(
                            () => {
                                if (!still()) return;
                                previous.connected = true;
                                mark(id, { state: "connected", error: "" });
                            },
                            (error: unknown) => {
                                const message = error instanceof Error ? error.message : String(error);
                                say("warn", id, `connect after the switch failed: ${message}`);
                                if (!still()) return;
                                previous.connected = false;
                                mark(id, { state: "failed", error: message });
                            }
                        );
                    },
                    (error: unknown) => {
                        const message = error instanceof Error ? error.message : String(error);
                        say("warn", id, `switch failed: ${message}`);
                        // A switch that never landed leaves a fiber running what
                        // the row does not say: the line carries the reason
                        // rather than sitting at `starting` forever.
                        if (!disposed && handles.get(id) === previous) {
                            mark(id, { state: "failed", error: `switching in place failed: ${message}`, note });
                        }
                    }
                );
                nextLines.set(id, { id, state: "starting", error: "", note, ...carry });
                report.updated++;
                return;
            }

            // Nothing moved: the key answers what it was answering. Only a first
            // connect (or a `mark`) says `connected`, so a line that failed, or
            // that is still waiting, never reads back as live on its own.
            // A re-preparation answers `starting` while it runs; when it lands
            // on the very config the fiber already runs, the key is as live as
            // the fiber is — never stuck at the preparation's `starting`.
            const carried = previousLine?.state === "starting" && previous.connected === true ? "connected" : (previousLine?.state ?? "starting");
            const state: PoolLine<E>["state"] = carried === "connected" || carried === "starting" || carried === "failed" || carried === "conflict"
                ? carried
                : "starting";
            const error = state === "failed" ? (previousLine?.error === void 0 || previousLine.error === "" ? "this entry never started" : previousLine.error) : "";
            nextLines.set(id, { id, state, error, note, ...carry });
        });

        // A key the row no longer names keeps nothing it prepared.
        for (const id of new Set([...preparing.keys(), ...prepared.keys()])) {
            if (!nextLines.has(id)) forget(id);
        }

        // Anything live that the row no longer names is gone.
        for (const [id, handle] of [...handles]) {
            if (nextLines.has(id)) continue;
            handles.delete(id);
            clearDeadline(handle);
            void Promise.resolve(handle.fiber.dispose()).catch((error: unknown) =>
                say("warn", id, `fiber shutdown failed: ${String(error)}`));
            report.stopped++;
            say("info", id, "stopped (its entry is no longer in the row)");
        }

        handles.clear();
        for (const [id, handle] of nextHandles) handles.set(id, handle);
        lines.clear();
        for (const [id, line] of nextLines) lines.set(id, line);

        publish();
        return report;
    };

    return {
        reconcile,
        refresh: () => {
            if (disposed) return;
            reconcile();
        },
        dispose(): void {
            if (disposed) return;
            disposed = true;
            for (const id of [...preparing.keys()]) forget(id);
            prepared.clear();
            for (const [id, handle] of [...handles]) {
                handles.delete(id);
                clearDeadline(handle);
                void Promise.resolve(handle.fiber.dispose()).catch((error: unknown) =>
                    say("warn", id, `fiber shutdown failed: ${String(error)}`));
            }
            lines.clear();
        },
        live: () => [...lines.values()],
        mark,
        invalidate(id: string): void {
            if (disposed) return;
            forget(id);
            reconcile();
        }
    };
}
