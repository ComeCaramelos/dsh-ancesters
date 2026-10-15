/**
 * The live mirror — the *only* channel a host answers through.
 *
 * Every answer the card reads (status lines, probe results, run state) is a
 * `.volatile()` field of the same configuration document the card edits, so
 * publishing is one volatile commit:
 *
 * ```
 * entry.update({ config: { …current config, …live } }, false, false)
 * settings.describe()
 * ```
 *
 * Three properties make it the right channel (verified against dsh 0.2.0-rc.2):
 *
 * - a volatile-only diff **persists nothing** — the profile patch stays exactly
 *   as the user wrote it;
 * - it **never remounts** the fiber (no restart, no lost tools);
 * - it bumps the revision `describe()` turns into `settings/document-updated`,
 *   so a card settles off its own snapshot instead of polling — and a describe
 *   that saw no raw change emits nothing, so calling it after every publish is
 *   cheap.
 *
 * Publishing coalesces per microtask: one run touches several fields, and a
 * card that read them one by one would flash. A re-assert after a persisted
 * write is the same call: the write clears the live-only fields back to the
 * row's answers, so the mirror goes straight back out with what it carries
 * (see `persist.ts`) — on a **successful** write *and* on a refused one.
 *
 * A write this host never made clears them too: persisting **any** row
 * recomposes the profile layers, and every row's volatile references go back
 * to the schema defaults (measured on dsh 0.2.1-rc.3 — dismissing the welcome
 * notice was enough to empty a card). The loader reports that as a
 * volatile-update on this fiber, so the mirror listens for it and re-asserts
 * whenever the entry no longer carries what it publishes; its own commits
 * match, so they never loop.
 */
import { type AdapterContext, FIBER_ACTIVE, type SettingsForms, VOLATILE_UPDATE_EVENT } from "./dsh.js";
import { sameValue } from "../values.js";

/** How one mirror is read out, one field at a time. */
export interface LiveMirrorOptions {
    /** The current answers to stand in the references (undefined = nothing to
     * publish yet). */
    read(): Record<string, unknown> | undefined;
    /** The settings service (the `describe` that emits). */
    settings?(): SettingsForms | undefined;
    /** Log prefix. */
    name?: string;
}

/** One coalescing publisher. */
export interface LiveMirror {
    /** Queue a coalesced publish (a re-assert is the same call). */
    publish(): void;
    /** Whether a publish is standing queued. */
    queued(): boolean;
}

/**
 * Stand a live mirror over one host instance.
 *
 * `publish` never throws out of a run: a failed volatile commit is a warning
 * line (the next publish retries), and the mirror's state stays dirty so the
 * answers are never lost between attempts.
 */
export function createLiveMirror(ctx: AdapterContext, options: LiveMirrorOptions): LiveMirror {
    let dirty = false;
    let queued = false;

    const publish = () => {
        dirty = true;
        if (queued) return;
        queued = true;
        queueMicrotask(() => attempt());
    };

    /**
     * One attempt. A volatile commit only lands in the *running* references
     * while the fiber is ACTIVE — issued earlier, the loader reads the config
     * change as an ordinary update and restarts the instance instead, which is
     * the opposite of the whole point. So an early attempt waits for the load
     * to settle and tries again; a host that never activates answers nothing,
     * which is the correct absence.
     */
    const attempt = (): void => {
        if (!dirty) {
            queued = false;
            return;
        }
        const fiber = ctx.fiber as { state?: number; entry?: { options?: { config?: Record<string, unknown> }; update(options: Record<string, unknown>, create?: boolean, force?: boolean): Promise<unknown> | unknown }; await?(): Promise<unknown> } | undefined;
        if (fiber !== void 0 && fiber.state !== FIBER_ACTIVE) {
            if (typeof fiber.await !== "function") {
                queued = false;
                return;
            }
            queued = false;
            Promise.resolve(fiber.await()).then(publish, publish);
            return;
        }
        queued = false;
        if (fiber?.entry === void 0) return;
        dirty = false;
        const live = options.read();
        if (live === undefined) return;
        const committed = { ...(fiber.entry.options?.config ?? {}), ...live };
        // merge, do not create, do not force — the force path is the restart.
        Promise.resolve(fiber.entry.update({ config: committed }, false, false)).then(
            () => describe(ctx, options),
            (error: unknown) => {
                dirty = true;
                const logger = ctx.logger;
                if (logger !== void 0) logger.warn(`live mirror publish failed: ${String(error)}`);
            }
        );
    };

    // A reset this host did not ask for: some live key the entry carries no
    // longer matches what the mirror answers, so it goes straight back out.
    // Every volatile-update is checked, whatever paths it names — a settings
    // write lands as more than one update, and the one that clears the live
    // keys can report only the field the user edited.
    // The raw config is what is compared, never the references: those carry
    // the schema's defaults filled in, so they need not equal what was read,
    // and a reset clears the raw config the same moment it clears them.
    ctx.on?.(VOLATILE_UPDATE_EVENT, () => {
        const fiber = ctx.fiber as { entry?: { options?: { config?: Record<string, unknown> } } } | undefined;
        const config = fiber?.entry?.options?.config ?? {};
        let live: Record<string, unknown> | undefined;
        try {
            live = options.read();
        } catch {
            return;
        }
        if (live === undefined) return;
        const answers = live;
        if (Object.keys(answers).some((key) => !sameValue(config[key], answers[key]))) publish();
    });

    return { publish, queued: () => queued };
}

/** One `describe()` turns the new revision into the event the card settles
 * on; a describe with no raw change emits nothing, so it is cheap after every
 * commit. Failures are swallowed here on purpose: the next commit retries. */
function describe(ctx: AdapterContext, options: LiveMirrorOptions): void {
    const settings = options.settings === void 0 ? (ctx.get?.("settings") as SettingsForms | undefined) : options.settings();
    if (settings === void 0) return;
    try {
        settings.describe();
    } catch {
        // nothing described yet; the next publish or attach retries
    }
}
