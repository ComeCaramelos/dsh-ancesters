/**
 * The run chain — one unit of host work at a time, from a neutral context.
 *
 * Every executable action, merge or launch shares one invariant: **one run at a
 * time**. It is also *context-free*: a form commit is a config write, and a run
 * scheduled from the commit handler inherits the transaction's async-local
 * store through the promise continuation, so every follow-up config write the
 * run answers (the seeded field, the merged rows) reads as a *nested*
 * transaction — which the platform refuses outright, not queues. Binding the
 * run body to a contextless resource starts the whole chain clean.
 *
 * Nothing about a run's *meaning* lives here: discovery, merging or launching
 * are the consumer's. This is the serialization and the clean context.
 */
import { AsyncResource } from "node:async_hooks";

/** A run chain answers from a neutral async context — no transaction of the
 * scheduler rides it (`keepAsyncContext: false`). */

export interface RunChain {
    /** Queue one unit of work behind everything already standing. */
    queue(work: () => unknown): Promise<unknown>;
    /** Whether at least one unit is standing in the chain. */
    pending(): boolean;
}

/** One run chain per host instance. */
export function createRunChain(): RunChain {
    let tail: Promise<unknown> = Promise.resolve();
    let waiting = false;
    // A contextless `AsyncResource` is only a thing Node has; an adapter that
    // runs without async_hooks simply answers from the calling context.
    let bind: (callback: () => unknown) => () => unknown;
    if (typeof AsyncResource === "function") {
        const resource = new (AsyncResource as unknown as new (name: string, options?: Record<string, unknown>) => AsyncResource & { bind(callback: () => unknown): () => unknown })("dsh-ancesters run", { keepAsyncContext: false });
        bind = (callback) => resource.bind(callback);
    } else {
        bind = (callback) => callback;
    }

    const queue = (work: () => unknown): Promise<unknown> => {
        waiting = true;
        tail = tail.then(() => {
            try {
                return Promise.resolve(bind(work)());
            } catch (error) {
                return Promise.reject(error);
            }
        });
        // One catch keeps the chain alive however the run failed; the caller
        // still sees its own rejection.
        const settled = tail.then(
            (value) => {
                waiting = false;
                return value;
            },
            (error) => {
                waiting = false;
                throw error;
            }
        );
        tail = settled.catch(() => void 0);
        return settled;
    };

    return { queue, pending: () => waiting };
}
