/**
 * The run chain — one unit at a time, answering from a neutral context.
 */
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import test from "node:test";

import { createRunChain } from "../lib/host/runs.js";

test("runs serialize — one chain, in queue order", async () => {
    const chain = createRunChain();
    const order = [];
    const first = chain.queue(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push("first");
    });
    const second = chain.queue(async () => {
        order.push("second");
    });
    await Promise.all([first, second]);
    assert.deepEqual(order, ["first", "second"]);
});

test("a failing run leaves the chain alive for the next", async () => {
    const chain = createRunChain();
    let second = 0;
    await chain.queue(() => Promise.reject(new Error("run failed"))).catch(() => void 0);
    await chain.queue(() => {
        second = 1;
    });
    assert.equal(second, 1);
});

test("the body answers from a neutral context — a commit transaction never rides it", async () => {
    const chain = createRunChain();
    const store = new AsyncLocalStorage();
    const observed = await store.run({ transaction: true }, async () =>
        chain.queue(async () => store.getStore())
    );
    assert.equal(observed, undefined, "the run must not inherit the scheduler's transaction");
});

test("pending answers between queue and landing", async () => {
    const chain = createRunChain();
    assert.equal(chain.pending(), false);
    const running = chain.queue(() => new Promise((resolve) => setTimeout(resolve, 1)));
    assert.equal(chain.pending(), true);
    await running;
    assert.equal(chain.pending(), false);
});
