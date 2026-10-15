/**
 * The fiber pool — N live keys behind one list field.
 *
 * The diff is the whole mechanism, so it is what the tests hold: a false
 * `start` answers a **fiber-shaped thenable** (the shape a loader child answers
 * with), recording the config it was handed, the switches it took, the
 * disposals it saw, and the door that settles the first connect.
 *
 * Nothing here imports a domain: no kinds, no transports. A pool that needed
 * them would not be a pool.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createFiberPool } from "../lib/host/pool.js";

/** A context narrow enough to be the pool's whole view of the world.
 * `resolveConfig` lets one test decide what the resolver answers, so the diff
 * can be pinned against *that* and not against the entry. */
function harness(entries = [], resolveConfig, overrides = {}) {
    const started = [];
    const logs = [];
    const ctx = {
        logger: {
            info: (line) => logs.push(["info", String(line)]),
            warn: (line) => logs.push(["warn", String(line)]),
            error: (line) => logs.push(["error", String(line)])
        }
    };
    const state = { entries };
    const pool = createFiberPool(ctx, {
        prefix: "test",
        entries: () => state.entries,
        id: (entry) => entry.id,
        enabled: (entry) => entry.enabled !== false,
        resolve: (entry) => (entry.error !== void 0
            ? { error: entry.error }
            : typeof resolveConfig === "function"
                ? { config: resolveConfig(entry) }
                : { config: entry.config, note: entry.note ?? "" }),
        start(config, entry) {
            let answer = () => void 0;
            let refuse = () => void 0;
            const first = new Promise((resolve, reject) => {
                answer = resolve;
                refuse = reject;
            });
            const record = { config, entry: entry.id, updates: [], disposed: 0, settle: answer, fail: refuse };
            started.push(record);
            return {
                update: (next) => {
                    record.updates.push(next);
                    record.config = next;
                    return Promise.resolve();
                },
                dispose: () => {
                    record.disposed++;
                    return Promise.resolve();
                },
                then: (onResolve, onReject) => first.then(onResolve, onReject)
            };
        },
        log: (level, message) => logs.push([level, message]),
        validate: (entry) => (entry.id === "" ? { error: "an entry with no key" } : undefined),
        // A test may stand its own ceiling, deadline or start over the default.
        ...overrides
    });
    return { pool, ctx, logs, started, entries: (rows) => { state.entries = rows; }, lines: () => pool.live() };
}

/** Answer every pending first connect. */
function settle(started) {
    for (const record of started) record.settle();
}

/** Let queued microtasks run. */
async function idle() {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

function lineFor(h, id) {
    return h.lines().find((line) => line.id === id);
}

test("a pool that names no logger still speaks through the context it stands on", async () => {
    const h = harness([{ id: "one", config: { n: 1 } }], void 0, { log: void 0 });
    h.pool.reconcile();
    settle(h.started);
    await idle();

    // No `log` hole is not silence: a pool that says nothing is a pool whose
    // broken keys nobody can find out about.
    assert.ok(h.logs.some(([, line]) => /one.*started|started/u.test(line)), "the start was said");
    h.pool.dispose();
});

test("every enabled key starts one fiber, and answers once it connects", async () => {
    const h = harness([{ id: "one", config: { n: 1 } }, { id: "two", config: { n: 2 } }]);
    h.pool.reconcile();
    settle(h.started);
    await idle();

    assert.equal(h.started.length, 2);
    assert.equal(h.started[0].config.n, 1);
    assert.equal(lineFor(h, "one").state, "connected");
    assert.equal(lineFor(h, "two").state, "connected");

    h.pool.dispose();
});

test("the diff runs off what the resolver answered, never off the entry", async () => {
    // The resolver answers `{ command }` only: every other field of the entry is
    // the consumer's own, and one that moved must never bounce a live fiber.
    const h = harness([{ id: "one", command: "a", label: "first" }], (entry) => ({ command: entry.command }));
    h.pool.reconcile();
    settle(h.started);
    await idle();
    assert.deepEqual(h.started[0].config, { command: "a" });

    h.entries([{ id: "one", command: "a", label: "renamed" }]);
    h.pool.refresh();
    await idle();
    assert.equal(h.started[0].updates.length, 0);
    assert.equal(h.started[0].disposed, 0);

    h.entries([{ id: "one", command: "b", label: "renamed" }]);
    h.pool.refresh();
    await idle();
    assert.equal(h.started.length, 1);
    assert.equal(h.started[0].updates.length, 1);
    assert.equal(h.started[0].disposed, 0);

    h.pool.dispose();
});

test("a disabled entry stops its fiber and answers `off`, leaving the rest alone", async () => {
    const rows = [{ id: "one", config: {} }, { id: "two", config: {} }];
    const h = harness(rows);
    h.pool.reconcile();
    settle(h.started);
    await idle();

    h.entries([rows[0], { ...rows[1], enabled: false }]);
    h.pool.reconcile();
    await idle();
    assert.equal(h.started[1].disposed, 1);
    assert.equal(h.started[0].disposed, 0);
    assert.equal(lineFor(h, "two").state, "off");

    h.entries(rows);
    h.pool.reconcile();
    settle(h.started);
    await idle();
    assert.equal(h.started.length, 3);
    assert.equal(h.started[2].entry, "two");

    h.pool.dispose();
});

test("an entry the row no longer names loses its fiber", async () => {
    const rows = [{ id: "one", config: {} }, { id: "two", config: {} }];
    const h = harness(rows);
    h.pool.reconcile();
    settle(h.started);
    await idle();

    h.entries([rows[0]]);
    h.pool.reconcile();
    await idle();
    assert.equal(h.started[1].disposed, 1);
    assert.equal(h.lines().find((line) => line.id === "two"), undefined);

    h.pool.dispose();
});

test("a first connect that fails is a line with its own error, not a failed pool", async () => {
    const h = harness([{ id: "missing", config: {} }, { id: "fine", config: {} }]);
    h.pool.reconcile();
    h.started[0].fail(new Error("ENOENT: nothing to run"));
    settle(h.started);
    await idle();

    assert.equal(lineFor(h, "missing").state, "failed");
    assert.match(lineFor(h, "missing").error, /ENOENT/u);
    assert.equal(lineFor(h, "fine").state, "connected");
    assert.ok(h.logs.some(([level]) => level === "warn"));

    h.pool.dispose();
});

test("an entry that resolves to nothing answers the reason and starts nothing", async () => {
    const h = harness([{ id: "good", config: {} }, { id: "bad", error: "nothing is registered under it" }]);
    const report = h.pool.reconcile();

    assert.equal(lineFor(h, "good").state, "starting");
    assert.equal(lineFor(h, "bad").state, "failed");
    assert.match(lineFor(h, "bad").error, /registered/u);
    assert.deepEqual(report.errors, ["nothing is registered under it"]);

    h.pool.dispose();
});

test("two entries claiming one key: the first claimant stays live, the second answers the conflict", async () => {
    const rows = [{ id: "same", config: {} }, { id: "same", config: { other: true } }];
    const h = harness(rows);
    const report = h.pool.reconcile();
    const lines = h.lines().filter((line) => line.id === "same");

    // One line per key: the live claimant answers it, and the duplicate is
    // reported, never allowed to stand up a second fiber or to stop the first.
    assert.equal(lines.length, 1);
    assert.equal(lines[0].state, "starting");
    assert.equal(h.started.length, 1);
    assert.equal(h.started[0].disposed, 0);
    assert.equal(report.stopped, 0);
    assert.match(report.errors.join("|"), /already claimed/u);
    assert.ok(h.logs.some(([level]) => level === "warn"));

    // A claim that stands with no live fiber behind it answers `conflict` on
    // its own line — there is nothing left to keep.
    h.entries([{ id: "same", config: {}, enabled: false }, { id: "same", config: { other: true } }]);
    const second = h.pool.reconcile();
    assert.equal(lineFor(h, "same").state, "conflict");
    assert.match(second.errors.join("|"), /already claimed/u);

    h.pool.dispose();
});

test("a key that fails the identity rule answers before anything else", async () => {
    const h = harness([{ id: "", config: {} }, { id: "fine", config: {} }]);
    h.pool.reconcile();
    settle(h.started);
    await idle();

    const broken = h.lines().find((line) => line.id === "");
    assert.equal(broken.state, "failed");
    assert.match(broken.error, /no key/u);
    assert.equal(h.started.length, 1, "nothing starts for a key that cannot exist");
    assert.equal(lineFor(h, "fine").state, "connected");

    h.pool.dispose();
});

test("every registered key keeps a line, running or not", async () => {
    const h = harness([
        { id: "on", config: {} },
        { id: "off", config: {}, enabled: false },
        { id: "bad", error: "no resolver" }
    ]);
    h.pool.reconcile();
    assert.deepEqual(h.lines().map((line) => line.id), ["on", "off", "bad"]);
    h.pool.dispose();
});

test("dispose stops every live fiber and silences the answers still coming", async () => {
    const h = harness([{ id: "one", config: {} }]);
    h.pool.reconcile();

    h.pool.dispose();
    // A first connect that lands afterwards must not resurrect the line.
    h.started[0].settle();
    await idle();
    assert.equal(h.started[0].disposed, 1);
    assert.equal(h.lines().length, 0);

    h.pool.reconcile();
    assert.equal(h.started.length, 1, "a disposed pool starts nothing again");
});

test("the cap answers a line instead of starting past the ceiling", async () => {
    const h = harness([{ id: "one", config: {} }, { id: "two", config: {} }]);
    // The spec stood up without a cap; exercise it through a second pool.
    let started2 = 0;
    const rows = [{ id: "one", config: {} }, { id: "two", config: {} }];
    const ctx = { logger: { info: () => void 0, warn: () => void 0 } };
    const pool = createFiberPool(ctx, {
        cap: 1,
        entries: () => rows,
        id: (entry) => entry.id,
        enabled: () => true,
        resolve: (entry) => ({ config: entry.config }),
        start() {
            started2++;
            return { update: () => void 0, dispose: () => void 0 };
        }
    });
    pool.reconcile();
    assert.equal(started2, 1);
    const lines = pool.live();
    assert.equal(lines[1].state, "failed");
    assert.match(lines[1].error, /ceiling/u);
    pool.dispose();
});

test("a published line keeps what the diff does not touch", async () => {
    const h = harness([{ id: "one", config: {} }]);
    h.pool.reconcile();
    settle(h.started);
    await idle();
    assert.equal(h.pool.mark("one", { extras: { tools: ["a", "b"] } }), true);

    h.pool.refresh();
    const line = lineFor(h, "one");
    assert.deepEqual(line.extras, { tools: ["a", "b"] });
    assert.equal(h.pool.mark("gone", { state: "connected" }), false);

    h.pool.dispose();
});

/** A fiber that answers its first connect immediately (no door to settle). */
function eager(overrides = {}) {
    return {
        update: () => Promise.resolve(),
        dispose: () => void 0,
        then: (onResolve) => Promise.resolve().then(onResolve),
        ...overrides
    };
}

test("a line that has not answered stays a wait: a late reconcile never reads live on its own", async () => {
    const h = harness([{ id: "one", config: {} }]);
    h.pool.reconcile();
    assert.equal(lineFor(h, "one").state, "starting");

    // Nothing answered yet: a reconcile must not read that as connected.
    h.pool.refresh();
    await idle();
    assert.equal(lineFor(h, "one").state, "starting");

    // And once it fails, that failure stands across reconciles until something
    // starts the key again — a dead fiber never goes back to live by waiting.
    h.started[0].fail(new Error("ENOENT: nothing to run"));
    await idle();
    h.pool.refresh();
    assert.equal(lineFor(h, "one").state, "failed");
    assert.match(lineFor(h, "one").error, /ENOENT/u);
    h.pool.refresh();
    assert.equal(lineFor(h, "one").state, "failed");

    h.pool.dispose();
});

test("a `start` that throws answers the reason and gets retried, never left waiting", async () => {
    let broken = true;
    const began = [];
    const h = harness([{ id: "one", config: { n: 1 } }], void 0, {
        start: (config) => {
            if (broken) throw new Error("nothing to run");
            began.push(config);
            return eager();
        }
    });

    const first = h.pool.reconcile();
    assert.equal(first.started, 0, "a start that threw started nothing");
    assert.equal(lineFor(h, "one").state, "failed");
    assert.match(lineFor(h, "one").error, /nothing to run/u);
    assert.deepEqual(first.errors, ["nothing to run"]);

    broken = false;
    const second = h.pool.reconcile();
    assert.equal(second.started, 1, "the next reconcile tries `start` again");
    assert.equal(began.length, 1);
    assert.equal(lineFor(h, "one").state, "starting");

    h.pool.dispose();
});

test("the ceiling counts what this reconcile leaves live, not what it is dropping", async () => {
    let rows = [{ id: "one", config: {} }, { id: "two", config: {} }];
    const h = harness(rows, void 0, { cap: 2 });
    h.pool.reconcile();
    settle(h.started);
    await idle();

    // The row swaps both keys out. Standing them down happens in the same
    // reconcile, so the two new keys are inside the ceiling.
    rows = [{ id: "three", config: {} }, { id: "four", config: {} }];
    h.entries(rows);
    const report = h.pool.reconcile();
    assert.equal(report.stopped, 2);
    assert.equal(report.started, 2);
    assert.deepEqual(h.lines().map((line) => line.id), ["three", "four"]);
    assert.equal(h.lines().some((line) => line.error !== ""), false, "nothing on the ceiling");

    h.pool.dispose();
});

test("a first connect that stands unanswered past its deadline becomes a failed line", async () => {
    const h = harness([{ id: "quiet", config: {} }], void 0, { firstConnectMs: 2 });
    h.pool.reconcile();
    assert.equal(lineFor(h, "quiet").state, "starting");
    await new Promise((resolve) => setTimeout(resolve, 12));
    assert.equal(lineFor(h, "quiet").state, "failed");
    assert.match(lineFor(h, "quiet").error, /did not answer within 2ms/u);
    h.pool.dispose();
});

test("an answered first connect never carries the deadline it beat", async () => {
    const h = harness([{ id: "quick", config: {} }], void 0, { firstConnectMs: 3 });
    h.pool.reconcile();
    h.started[0].settle();
    await idle();
    await new Promise((resolve) => setTimeout(resolve, 12));
    assert.equal(lineFor(h, "quick").state, "connected");
    h.pool.dispose();
});

test("a switch that lands answers connected again once the fiber does — never stuck at starting", async () => {
    let reconnect = () => void 0;
    let refuse = () => void 0;
    let waiting = Promise.resolve();
    const h = harness([{ id: "one", command: "a" }], (entry) => ({ command: entry.command }), {
        start: () => ({
            update: () => {
                // The switch restarts what runs: its connect is a new answer.
                waiting = new Promise((resolve, reject) => {
                    reconnect = resolve;
                    refuse = reject;
                });
                return Promise.resolve();
            },
            dispose: () => void 0,
            then: (onResolve, onReject) => waiting.then(onResolve, onReject)
        })
    });
    h.pool.reconcile();
    await idle();
    assert.equal(lineFor(h, "one").state, "connected");

    h.entries([{ id: "one", command: "b" }]);
    h.pool.refresh();
    await idle();
    assert.equal(lineFor(h, "one").state, "starting", "while the switched fiber connects");
    reconnect();
    await idle();
    assert.equal(lineFor(h, "one").state, "connected", "its connect is what says it is live again");

    h.entries([{ id: "one", command: "c" }]);
    h.pool.refresh();
    await idle();
    refuse(new Error("the bridge never came back"));
    await idle();
    assert.equal(lineFor(h, "one").state, "failed");
    assert.match(lineFor(h, "one").error, /never came back/u);

    h.pool.dispose();
});

test("after a switch the line waits for the restart (`await()`), not for a thenable that answers early", async () => {
    let restarted = () => void 0;
    let restart = Promise.resolve();
    const h = harness([{ id: "one", command: "a" }], (entry) => ({ command: entry.command }), {
        start: () => ({
            // cordis: `update` returns before the restart it schedules…
            update: () => {
                restart = new Promise((resolve) => {
                    restarted = resolve;
                });
                return void 0;
            },
            dispose: () => void 0,
            // …a thenable would answer at once…
            then: (onResolve) => Promise.resolve().then(onResolve),
            // …and `await()` is what settles with the restart.
            await: () => restart
        })
    });
    h.pool.reconcile();
    await idle();
    assert.equal(lineFor(h, "one").state, "connected");

    h.entries([{ id: "one", command: "b" }]);
    h.pool.refresh();
    await idle();
    assert.equal(lineFor(h, "one").state, "starting", "still restarting");
    restarted();
    await idle();
    assert.equal(lineFor(h, "one").state, "connected", "live once the restart settled");

    h.pool.dispose();
});

test("a re-preparation that lands on the config already running answers connected again", async () => {
    // An entry edit that does not move what runs (a profile picked explicitly
    // that the row already defaulted to): the asynchronous kind prepares again,
    // the line reads `starting` meanwhile, and the answer is the same config.
    const h = harness([{ id: "one", label: "a" }], void 0, {
        resolve: async () => ({ config: { command: "gateway" } }),
        start: () => ({
            update: () => Promise.resolve(),
            dispose: () => void 0,
            then: (onResolve) => Promise.resolve().then(onResolve)
        })
    });
    h.pool.reconcile();
    await idle();
    await idle();
    assert.equal(lineFor(h, "one").state, "connected");

    h.entries([{ id: "one", label: "b" }]);
    h.pool.refresh();
    assert.equal(lineFor(h, "one").state, "starting", "preparing again reads as starting");
    await idle();
    await idle();
    assert.equal(lineFor(h, "one").state, "connected", "the same config, still running, is live — not stuck at starting");

    h.pool.dispose();
});

test("a switch that fails says so on the line instead of waiting forever", async () => {
    let broken = false;
    const h = harness([{ id: "one", command: "a" }], (entry) => ({ command: entry.command }), {
        start: () => ({
            update: () => (broken ? Promise.reject(new Error("the bridge refused")) : Promise.resolve()),
            dispose: () => void 0,
            then: (onResolve) => Promise.resolve().then(onResolve)
        })
    });
    h.pool.reconcile();
    await idle();
    assert.equal(lineFor(h, "one").state, "connected");

    broken = true;
    h.entries([{ id: "one", command: "b" }]);
    h.pool.refresh();
    await idle();
    assert.equal(lineFor(h, "one").state, "failed");
    assert.match(lineFor(h, "one").error, /switching in place failed/u);

    h.pool.dispose();
});
