/**
 * Shared fakes for the adapter tests — exactly what the plugin host answers,
 * nothing more. The point of the fakes is that no adapter behavior can hide
 * behind a real host: if a rule lives in a real `PluginContext`, the fake has
 * to have it too.
 */

/** A logger that records its calls. */
export function fakeLogger() {
    const calls = { error: [], warn: [], info: [] };
    return {
        calls,
        error(...args) {
            calls.error.push(args.join(" "));
        },
        warn(...args) {
            calls.warn.push(args.join(" "));
        },
        info(...args) {
            calls.info.push(args.join(" "));
        }
    };
}

/** A loader entry that answers `options` and records `update` calls. */
export function fakeEntry(initial = {}) {
    const updates = [];
    return {
        updates,
        options: { id: "profile-entry", config: { ...initial } },
        update(next, create, force) {
            updates.push({ next, create, force });
            if (next !== undefined && typeof next === "object" && next.config !== undefined) {
                this.options.config = { ...this.options.config, ...next.config };
            }
            return Promise.resolve();
        }
    };
}

/** A fiber the host can see: state 2 = ACTIVE. */
export function fakeFiber(entry, { state = 2, awaiting = false } = {}) {
    const fiber = { state, entry };
    if (awaiting) {
        fiber.await = () => {
            fiber.state = 2;
            return Promise.resolve();
        };
    }
    return fiber;
}

/** The `settings` service, recording every call. */
export function fakeSettings({ documents = [{ entryId: "profile-entry", revision: 1 }], configureThrows = false, configureCalls = [], mutateBehavior = "resolve" } = {}) {
    const calls = { describes: 0, configures: configureCalls, mutates: [], configureThrows: 0 };
    let configureCount = 0;
    return {
        calls,
        describe() {
            calls.describes++;
            return documents.map((document) => ({ ...document }));
        },
        configure(presentation, owner) {
            configureCount++;
            if (configureThrows && configureCount > 1) {
                calls.configureThrows++;
                throw new Error("configure: already configured for this fiber");
            }
            calls.configures.push({ presentation, owner });
            return () => calls.configures.push({ disposed: true });
        },
        mutate(entryId, ops) {
            calls.mutates.push({ entryId, ops });
            if (mutateBehavior === "reject") return Promise.reject(new Error("write refused by the row"));
            return Promise.resolve();
        }
    };
}

/** A plugin context standing in for the loader's. */
export function fakeCtx({ fiber, settings } = {}) {
    const effects = [];
    const events = new Map();
    const ctx = {
        fiber,
        effects,
        events,
        logger: fakeLogger(),
        effect(setup, name) {
            effects.push({ setup, name, dispose: undefined });
            effects[effects.length - 1].dispose = setup();
        },
        inject(names, callback) {
            callback({ ...ctx, settings });
        },
        get(name) {
            return name === "settings" ? settings : undefined;
        },
        on(event, handler) {
            const handlers = events.get(event) ?? [];
            handlers.push(handler);
            events.set(event, handlers);
            return () => {
                const index = handlers.indexOf(handler);
                if (index >= 0) handlers.splice(index, 1);
            };
        },
        /** Fire one registered event. */
        emit(event, ...args) {
            for (const handler of [...(events.get(event) ?? [])]) handler(...args);
        },
        /** Run every effect's disposer. */
        disposeAll() {
            for (const effect of effects) effect.dispose?.();
        }
    };
    return ctx;
}

/** A microtask turn, so the coalesced publish can be observed. */
export const tick = () => new Promise((resolve) => queueMicrotask(resolve));
