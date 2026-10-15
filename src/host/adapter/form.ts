/**
 * Host half of the configuration form — `attachSettingsForm`.
 *
 * Since 0.2 every card edits its profile row's configuration form: one form
 * keyed by the row's profile **entry id** (`host/identity`), with the generated
 * page turned off while the card owns the row's page, and commits arriving as
 * volatile paths on the fiber. This module owns exactly that machinery and
 * nothing of any consumer's domain: which fields route as user-authored, what a
 * routed commit *means*, and which trigger fields fire runs — all three arrive
 * as holes on the spec.
 *
 * Three invariants (contratos-dsh §1) live here so no consumer can repeat them
 * wrong:
 *
 * - **Identity.** Every read and write goes by the profile entry id read off
 *   this fiber's own loader entry. A mount that is not a profile entry says so
 *   loudly; inventing a key of its own would silently alias.
 * - **The auto page stays off**, disposed with the effect that opened it: one
 *   `configure({ auto: false }, fiber)` per fiber — a second call for the same
 *   fiber throws, and an HMR reload that disposed nothing would leave two
 *   instances configuring.
 * - **Routing filters by field.** Only user-authored paths reach the
 *   consumer's commit handler — and that same filter is what keeps the live
 *   mirror's own volatile commits out of the router (a purely volatile publish
 * *never* re-enters, so it can never echo a write back — see `live.ts`).
 */
import { requireEntryId } from "../identity.js";
import { sameValue } from "../values.js";

import {
    type AdapterContext,
    requireSettingsForms,
    supportsSettingsForms,
    type SettingsForms,
    VOLATILE_UPDATE_EVENT
} from "./dsh.js";

/** A routed commit: the volatile paths, in the shape the loader reports. */
export interface FormCommit {
    paths: readonly (readonly string[])[];
}

/** Everything about one card's form the consumer declares. */
export interface SettingsFormSpec {
    /** What this instance is, for log lines. */
    name?: string;
    /** Names of user-authored fields: a commit touching one of them routes.
     * A commit that names only live-mirror fields routes nothing. */
    userFields: readonly string[];
    /** The live mirror's keys: the same field names, listed separately so
     * `persist` can clear them back to the row's answers (see persist.ts). */
    liveKeys?: readonly string[];
    /** Entry-id hole (default: this fiber's profile entry id). A consumer
     * that composes from a bare context may supply its own. */
    entryId?: string;
    /** Read the value one field currently answers — used to decide whether a
     * trigger field actually *changed* (see `actions`). */
    readValue?: (field: string) => unknown;
    /** Commit routing hole: called when user-authored paths changed. */
    onCommit?: (commit: FormCommit) => void | Promise<void>;
    /** Trigger holes: `{ [field]: runner }`. The **first** read of a trigger
     * value folds in silently — booting must never fire a run because the Host
     * read a stored trigger back; only a later diff fires, once, on the
     * run chain.
     *
     * Two trigger shapes ride the same hole (the `entryActions` idiom):
     *
     * - the **scalar** nonce — one stamp per field (`Date.now()`), what a card
     *   with one action writes: the diff answers on the whole value and the
     *   runner fires with nothing (exactly the reference behavior);
     * - the **keyed** nonce — a plain map `{ [key]: stamp }`, what a card with
     *   N rows writes through `controller.writeEntryTrigger(field, key)`: the
     *   diff answers **per key**, and every key whose stamp moved fires
     *   `run(String(key))` exactly once. A key that merely stands, or that
     *   disappeared (a row dropped), fires nothing.
     *
     * Nothing here can know what a key means — row index, path, id: the
     * package carries no row semantics, it only hands the key over. */
    actions?: Readonly<Record<string, (key?: string) => unknown>>;
    /** Describe hook: called with every document this service describes,
     * after the form attaches. Default: keep nothing. */
    describe?: (documents: unknown[]) => void;
    /** Attach hole: called with the form each time it stands up — once with
     * the entry id alone, again once the settings service answers — so a
     * controller that reads its layers through the form can switch over. */
    onAttach?: (form: { entryId: string; settings?: SettingsForms }) => void;
    /** Detach hole: called when the form leaves with the instance. */
    onDetach?: () => void;
}

/** What `attachSettingsForm` hands the consumer's controller. */
export interface SettingsFormHandle {
    /** The form once attached (`undefined` until the entry id resolves and the
     * service answers). */
    current(): { entryId: string; settings?: SettingsForms } | undefined;
    /** Every live-mirror key this form was told about. */
    liveKeys(): readonly string[];
    /** Whether a commit routing has ever landed. */
    attached(): boolean;
}

/**
 * One row's described document — its layers (`user`, `base`) and value — read
 * through the settings service by its namespace (the profile entry id).
 * Undefined when the service, or the row, is not described yet: the cold path,
 * where only the running references answer. A service that cannot answer is
 * that same cold path, never a throw.
 */
export function readFormRow<T extends { ns: string } = { ns: string; user?: unknown; base?: unknown; value?: unknown }>(
    settings: { describe(): unknown } | undefined,
    entryId: string
): T | undefined {
    if (settings === void 0) return void 0;
    try {
        const rows = settings.describe();
        return Array.isArray(rows) ? (rows as T[]).find((row) => row !== null && typeof row === "object" && row.ns === entryId) : void 0;
    } catch {
        return void 0;
    }
}

/** Whether one volatile-path list touches anything user-authored. */
export function routesUserCommit(paths: readonly (readonly string[])[], userFields: ReadonlySet<string>): boolean {
    return paths.some((path) => path.length > 0 && userFields.has(String(path[0])));
}

/**
 * Attach one row's configuration form inside `ctx.effect` (so it disposes with
 * the instance) and return the handle the controller keeps.
 */
export function attachSettingsForm(ctx: AdapterContext, spec: SettingsFormSpec): SettingsFormHandle {
    let form: { entryId: string; settings?: SettingsForms } | undefined = void 0;
    let configured = false;
    let lastTrigger: Record<string, unknown> | undefined = void 0;
    const userFields = new Set((spec.userFields ?? []).map(String));

    const handle: SettingsFormHandle = {
        current: () => form,
        liveKeys: () => spec.liveKeys ?? [],
        attached: () => form !== undefined
    };

    ctx.effect(() => {
        // Declared before the inject callback may set it (`ctx.inject` answers
        // synchronously for an already-resolved service).
        let disposeForm: (() => void) | undefined = void 0;
        let entryId: string;
        try {
            entryId = spec.entryId ?? requireEntryId({ fiber: ctx.fiber } as never);
        } catch (error) {
            // Loud, once: nothing can address this instance through the form,
            // so it can be neither read nor written. Everything else keeps
            // working (the row config drives the host exactly as before).
            (ctx.logger?.error ?? (() => void 0))(String(error instanceof Error ? error.message : error));
            return () => void 0;
        }
        form = { entryId };
        spec.onAttach?.(form);

        ctx.inject?.(["settings"], (inner) => {
            const service = (inner as unknown as { settings?: unknown })?.settings;
            if (service === void 0) return;
            if (!supportsSettingsForms(service)) {
                // A half-shaped surface is louder than a silent default: name
                // it once and keep everything else running.
                try {
                    requireSettingsForms(service);
                } catch (error) {
                    (ctx.logger?.error ?? (() => void 0))(String(error));
                }
                return;
            }
            form = { entryId, settings: service };
            if (!configured) {
                configured = true;
                try {
                    // The card is the page, so the generated one stays off.
                    // Twice for one fiber throws — guarded here, disposed below.
                    const dispose = service.configure({ auto: false }, ctx.fiber);
                    disposeForm = disposeForm === void 0 ? dispose : (): void => {
                        void dispose();
                    };
                } catch (error) {
                    // The row still routes commits; only the generated page may
                    // stand alongside. Loud once, never fatal.
                    (ctx.logger?.warn ?? (() => void 0))(String(error));
                }
            }
            spec.onAttach?.(form);
        });

        const describeHook = spec.describe;
        if (typeof describeHook === "function" && form?.settings !== void 0) {
            try {
                describeHook(form.settings.describe() as unknown[]);
            } catch {
                // nothing described yet; the next commit retries
            }
        }

        // Commits land as volatile paths on this fiber. Only user-authored
        // paths mean anything; trigger fields diff there rather than on their
        // mere presence (a stored trigger folding in on boot must not launch).
        ctx.on?.(VOLATILE_UPDATE_EVENT, (paths: readonly (readonly string[])[]) => {
            if (!routesUserCommit(paths, userFields)) return;
            fireTriggers(spec, lastTrigger);
            lastTrigger = readTriggers(spec);
            void Promise.resolve(spec.onCommit?.({ paths: paths })).catch((error: unknown) => {
                (ctx.logger?.error ?? (() => void 0))(String(error));
            });
        });

        return () => {
            if (disposeForm !== void 0) disposeForm();
            form = void 0;
            spec.onDetach?.();
        };
    }, "dsh-ancesters: configuration form");

    return handle;
}

/** Every trigger field's current value (undefined answers when unreadable). */
function readTriggers(spec: SettingsFormSpec): Record<string, unknown> {
    const read = spec.readValue;
    const values: Record<string, unknown> = {};
    if (typeof read !== "function") return values;
    for (const field of Object.keys(spec.actions ?? {})) {
        try {
            values[field] = read(field);
        } catch {
            values[field] = void 0;
        }
    }
    return values;
}

/**
 * The nonce idiom: a first observation folds in silently; only a later diff
 * fires. A persisted trigger that merely *stands* must never launch anything
 * on its own (a stored run trigger read back at boot is not a run request).
 */
function fireTriggers(spec: SettingsFormSpec, previous: Record<string, unknown> | undefined): void {
    const actions = spec.actions ?? {};
    const current = readTriggers(spec);
    if (previous === undefined) return; // the registration read folds in
    for (const [field, run] of Object.entries(actions)) {
        const before = keyedNonce(previous[field]);
        const now = keyedNonce(current[field]);
        if (now !== undefined) {
            // Keyed nonce: the diff answers per key. A key the map *loses*
            // (the row it stood for was dropped) answers nothing — a removed
            // row requests no run; the map standing empty is the same answer.
            for (const [key, stamp] of now) {
                if (stamp === void 0) continue;
                // No keyed answer before (a first stamp, or the shape moved
                // from scalar) still stands as a diff for every stamp.
                if (!sameValue(before === undefined ? void 0 : before.get(key), stamp)) fire(run, key);
            }
            continue;
        }
        if (current[field] !== void 0 && current[field] !== previous[field]) fire(run, void 0);
    }
}

/** Fire one runner, with its key when the trigger keyed by row (a runner that
 * answers with a throw is the consumer's business, never the routing's). */
function fire(run: (key?: string) => unknown, key: string | undefined): void {
    try {
        if (key === void 0) void (run as () => unknown)();
        else void run(key);
    } catch {
        // The consumer's own logging covers it; a trigger that throws
        // must not break the commit routing.
    }
}

/** The keyed nonce shape: a plain object mapping keys to non-object stamps —
 * what `writeEntryTrigger` writes (one stamp per row). Anything else (scalar,
 * list, nested object) is not a trigger map: the diff then answers on the
 * whole value, exactly as a scalar nonce always did. */
function keyedNonce(value: unknown): Map<string, unknown> | undefined {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return void 0;
    const stamps = new Map<string, unknown>();
    for (const [key, stamp] of Object.entries(value as Record<string, unknown>)) {
        if (stamp !== null && typeof stamp === "object") return void 0;
        stamps.set(key, stamp);
    }
    return stamps;
}
