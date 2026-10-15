/**
 * The settle wait — how one host-run action resolves.
 *
 * A trigger write is armed *before* it crosses the wire, and it settles off the
 * form's own push: every Host answer advances the served revision, and the
 * subscription pushes it. No polling, no re-read: the wait is a subscription
 * with a wall-clock deadline, armed only because a Host that answers nothing
 * exists too.
 *
 * A wait that ends without the predicate ever standing stages **one** notice so
 * the card drops its busy overlay instead of holding it until someone reloads
 * the page — and a *refused* write is not a stall: nothing ran, the write door
 * already answered no, so the card's own error line is what reports it.
 */
import type { CardSnapshot } from "./snapshot.js";

/** How long one host-run action waits before reporting a stall (ms). */
export const RUN_SETTLE_TIMEOUT_MS = 90000;

/** The slice of the controller the wait needs. */
export interface WaitHost {
    disposed: boolean;
    /** The current snapshot (stall reporting reads `lastError` off it). */
    getSnapshot(): CardSnapshot;
    /** Arm one predicate against the next publish; the disposer drops it. */
    settleOn(settled: (snapshot: CardSnapshot) => boolean): { settle: Promise<void>; cancel: () => void };
    /** Stage one failure notice the body's toast host announces. */
    noteNotice(kind: "error" | "stall", text: unknown): void;
    /** Surface a refused or failed write as the card's own error line. */
    noteError(error: unknown): void;
    /** The armed stall-deadline timer; owned by the wait so dispose can cancel
     * it. */
    settleTimer: unknown;
}

/**
 * Write, then settle: resolved when a later publish satisfies `settled`, or
 * when the deadline fires.
 *
 * @param host - the wait surface (the controller).
 * @param settled - the predicate the mirror must eventually satisfy.
 * @param write - the trigger write, issued only once the wait stands armed.
 * @param deadline - wall-clock budget, in ms.
 */
export function settleOnRevision(
    host: WaitHost,
    settled: (snapshot: CardSnapshot) => boolean,
    write: () => Promise<boolean> | boolean,
    deadline = RUN_SETTLE_TIMEOUT_MS
): Promise<void> {
    if (host.disposed) return Promise.resolve();
    let satisfied = false;
    const armed = host.settleOn((snapshot) => {
        if (settled(snapshot) !== true) return false;
        satisfied = true;
        return true;
    });
    return new Promise<void>((resolve) => {
        let done = false;
        const timer = setTimeout(() => finish(), deadline);
        host.settleTimer = timer;
        const finish = (refused = false) => {
            if (done) return;
            done = true;
            clearTimeout(timer as ReturnType<typeof setTimeout>);
            if (host.settleTimer === timer) host.settleTimer = null;
            armed.cancel();
            resolve();
            // A predicate that stood is already reported by whatever answer
            // landed in the mirror; a deadline that fired without one is the
            // stall the toast announces.
            if (refused || satisfied || host.disposed) return;
            const state = host.getSnapshot();
            if (state.lastError !== "") host.noteNotice("error", state.lastError);
            else host.noteNotice("stall", "");
        };
        void armed.settle.then(() => finish());
        // Issue the write only once the wait stands armed: a Host run that
        // lands while the write is still crossing the wire must not be missed.
        void Promise.resolve(write()).then(
            (accepted) => {
                if (accepted === false) {
                    host.noteError("configuration write refused");
                    finish(true);
                }
            },
            (error: unknown) => {
                host.noteError(error);
                finish(true);
            }
        );
    });
}
