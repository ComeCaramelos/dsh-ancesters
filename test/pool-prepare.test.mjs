/**
 * The fiber pool with an asynchronous `resolve` (R1).
 *
 * A key whose answer needs preparing (a daemon to wait for, a browser to
 * launch) parks at `starting`, prepares once per entry state, and lands by
 * reconciling again. What these tests hold are the four rules that keep that
 * from ever starting the wrong thing:
 *
 *   1. a late answer of a replaced, forgotten or disposed preparation never
 *      starts a fiber;
 *   2. the first-connect deadline only starts once a fiber does;
 *   3. a preparation that rejects (or outlives `resolveMs`) is that key's
 *      `failed` line, and the rest of the row stays live;
 *   4. two reconciles over the same entry never prepare twice.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createFiberPool } from "../lib/host/pool.js";

/**
 * A pool whose `resolve` answers a promise the test settles by hand: every
 * call is recorded with the entry it was asked for, and `answer(i, value)` /
 * `refuse(i, error)` settle the i-th call.
 */
function harness(entries, overrides = {}) {
    const asked = [];
    const started = [];
    const state = { entries };
    const pool = createFiberPool({ logger: {} }, {
        prefix: "test",
        entries: () => state.entries,
        id: (entry) => entry.id,
        enabled: (entry) => entry.enabled !== false,
        resolve(entry) {
            if (entry.sync === true) return { config: { sync: entry.id } };
            let answer;
            let refuse;
            const promise = new Promise((resolve, reject) => {
                answer = resolve;
                refuse = reject;
            });
            asked.push({ entry, answer, refuse });
            return promise;
        },
        start(config, entry) {
            const record = { config, entry: entry.id, updates: [], disposed: 0 };
            started.push(record);
            let settle;
            const first = new Promise((resolve) => {
                settle = resolve;
            });
            record.settle = settle;
            return {
                update: (next) => {
                    record.updates.push(next);
                    return Promise.resolve();
                },
                dispose: () => {
                    record.disposed++;
                    return Promise.resolve();
                },
                then: (onResolve, onReject) => first.then(onResolve, onReject)
            };
        },
        log: () => void 0,
        ...overrides
    });
    return {
        pool,
        asked,
        started,
        entries: (rows) => {
            state.entries = rows;
        },
        line: (id) => pool.live().find((line) => line.id === id)
    };
}

/** Let queued promise callbacks and zero timers run. */
async function idle() {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

test("a preparing key reads starting, starts nothing, and starts once its answer lands", async () => {
    const run = harness([{ id: "a", v: 1 }]);
    run.pool.reconcile();
    assert.equal(run.asked.length, 1);
    assert.equal(run.started.length, 0, "nothing runs before the answer");
    assert.equal(run.line("a").state, "starting");

    run.asked[0].answer({ config: { url: "x" }, note: "prepared" });
    await idle();
    assert.equal(run.started.length, 1);
    assert.deepEqual(run.started[0].config, { url: "x" });
    assert.equal(run.line("a").state, "starting", "started, but not connected until its first connect answers");
    assert.equal(run.line("a").note, "prepared");

    run.started[0].settle();
    await idle();
    assert.equal(run.line("a").state, "connected");
});

test("two reconciles over the same entry never prepare twice, before or after the answer", async () => {
    const run = harness([{ id: "a", v: 1 }]);
    run.pool.reconcile();
    run.pool.reconcile();
    assert.equal(run.asked.length, 1, "a pending preparation is reused");

    run.asked[0].answer({ config: { url: "x" } });
    await idle();
    run.pool.reconcile();
    run.pool.reconcile();
    assert.equal(run.asked.length, 1, "a landed answer is kept while the entry stands");
    assert.equal(run.started.length, 1);
    assert.equal(run.started[0].updates.length, 0, "and nothing switches");
});

test("a late answer of a replaced preparation never starts anything", async () => {
    const run = harness([{ id: "a", v: 1 }]);
    run.pool.reconcile();
    run.entries([{ id: "a", v: 2 }]);
    run.pool.reconcile();
    assert.equal(run.asked.length, 2, "a changed entry prepares again");

    run.asked[0].answer({ config: { from: "old" } });
    await idle();
    assert.equal(run.started.length, 0, "the old answer is dropped on arrival");

    run.asked[1].answer({ config: { from: "new" } });
    await idle();
    assert.equal(run.started.length, 1);
    assert.deepEqual(run.started[0].config, { from: "new" });
});

test("turning a key off or removing it forgets its preparation", async () => {
    const run = harness([{ id: "a" }, { id: "b" }]);
    run.pool.reconcile();
    run.entries([{ id: "a", enabled: false }]);
    run.pool.reconcile();
    assert.equal(run.line("a").state, "off");
    assert.equal(run.line("b"), void 0);

    run.asked[0].answer({ config: { a: 1 } });
    run.asked[1].answer({ config: { b: 1 } });
    await idle();
    assert.equal(run.started.length, 0, "neither late answer starts anything");

    run.entries([{ id: "a" }]);
    run.pool.reconcile();
    assert.equal(run.asked.length, 3, "turning it back on prepares again");
});

test("a disposed pool drops a late answer", async () => {
    const run = harness([{ id: "a" }]);
    run.pool.reconcile();
    run.pool.dispose();
    run.asked[0].answer({ config: { a: 1 } });
    await idle();
    assert.equal(run.started.length, 0);
});

test("a preparation that rejects is that key's failed line; the rest stays live", async () => {
    const run = harness([{ id: "a" }, { id: "b", sync: true }]);
    run.pool.reconcile();
    assert.equal(run.started.length, 1, "a synchronous neighbour starts at once");

    run.asked[0].refuse(new Error("docker backend never came up"));
    await idle();
    assert.equal(run.line("a").state, "failed");
    assert.equal(run.line("a").error, "docker backend never came up");
    assert.equal(run.started.length, 1);
    assert.equal(run.started[0].disposed, 0, "the neighbour is untouched");

    run.pool.reconcile();
    assert.equal(run.asked.length, 1, "a failed preparation is kept too: editing the entry retries it");
    assert.equal(run.line("a").state, "failed");
});

test("a preparation that outlives resolveMs fails, and its late answer is dropped", async () => {
    const run = harness([{ id: "a" }], { resolveMs: 5 });
    run.pool.reconcile();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(run.line("a").state, "failed");
    assert.match(run.line("a").error, /did not answer within 5ms/);

    run.asked[0].answer({ config: { a: 1 } });
    await idle();
    assert.equal(run.started.length, 0);
});

test("the first-connect deadline starts with the fiber, not with the preparation", async () => {
    const run = harness([{ id: "a" }], { firstConnectMs: 15 });
    run.pool.reconcile();
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(run.line("a").state, "starting", "a slow preparation is not a slow first connect");

    run.asked[0].answer({ config: { a: 1 } });
    await idle();
    assert.equal(run.line("a").state, "starting");
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(run.line("a").state, "failed", "the deadline ran from the start");
    assert.match(run.line("a").error, /first connect did not answer within 15ms/);
});

test("a live key keeps running its old answer while a new one prepares, then switches in place", async () => {
    const run = harness([{ id: "a", v: 1 }]);
    run.pool.reconcile();
    run.asked[0].answer({ config: { v: 1 } });
    await idle();
    run.started[0].settle();
    await idle();

    run.entries([{ id: "a", v: 2 }]);
    run.pool.reconcile();
    assert.equal(run.started[0].disposed, 0, "nothing is torn down while the next answer prepares");
    assert.equal(run.line("a").state, "starting");

    run.asked[1].answer({ config: { v: 2 } });
    await idle();
    assert.equal(run.started.length, 1, "the same fiber");
    assert.deepEqual(run.started[0].updates, [{ v: 2 }], "switched in place to the new answer");
});

test("invalidate prepares again even though the entry did not change", async () => {
    const run = harness([{ id: "a" }]);
    run.pool.reconcile();
    run.asked[0].answer({ config: { launch: 1 } });
    await idle();

    run.pool.invalidate("a");
    assert.equal(run.asked.length, 2);
    run.asked[1].answer({ config: { launch: 2 } });
    await idle();
    assert.deepEqual(run.started[0].updates, [{ launch: 2 }]);
});

test("a resolver that throws synchronously is a line, never a broken reconcile", () => {
    const run = harness([{ id: "a" }, { id: "b", sync: true }], {
        resolve(entry) {
            if (entry.id === "a") throw new Error("boom");
            return { config: { b: 1 } };
        }
    });
    run.pool.reconcile();
    assert.equal(run.line("a").state, "failed");
    assert.equal(run.line("a").error, "boom");
    assert.equal(run.started.length, 1);
});
