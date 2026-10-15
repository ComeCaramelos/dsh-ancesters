/**
 * The two holes that keep the mechanism honest.
 *
 * A shared mechanism is only right if a consumer can drive it through holes:
 * one field whose meaning the shared half knows nothing about, and one trigger
 * whose *action* is entirely the consumer's. This test is that demonstration —
 * a card whose domain is `nothing-domain`, with nothing in the shared half
 * that references it.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { attachSettingsForm } from "../lib/host/adapter/form.js";
import { createRunChain } from "../lib/host/runs.js";
import { fakeCtx, fakeEntry, fakeFiber, fakeSettings } from "./helpers.mjs";

test("a routable field routes commits the shared half cannot interpret", () => {
    const ctx = fakeCtx({ fiber: fakeFiber(fakeEntry()), settings: fakeSettings() });
    const routed = [];
    attachSettingsForm(ctx, {
        userFields: ["nothingMode"],
        onCommit: ({ paths }) => {
            routed.push(paths[0][0]);
        }
    });
    // The field name means nothing to the shared half — and that is the point:
    // routing decides *that* something changed; what it means is the
    // consumer's answer, taken from the served document.
    ctx.emit("loader/volatile-update", [["nothingMode"], ["lastError"]]);
    assert.deepEqual(routed, ["nothingMode"]);
});

test("a nonce hole fires the consumer's own run and only a diff fires it", async () => {
    const runs = createRunChain();
    const values = { nothingNonce: 0 };
    const ctx = fakeCtx({ fiber: fakeFiber(fakeEntry()), settings: fakeSettings() });
    let launches = 0;
    attachSettingsForm(ctx, {
        userFields: ["nothingNonce", "nothingMode"],
        readValue: (field) => values[field],
        actions: {
            nothingNonce: () => {
                void runs.queue(async () => {
                    launches++;
                });
            }
        }
    });
    // The first fold (a stored value read back) launches nothing.
    ctx.emit("loader/volatile-update", [["nothingNonce"]]);
    await runs.queue(async () => void 0);
    assert.equal(launches, 0);

    // A real diff launches exactly once, on the chain.
    values.nothingNonce = Date.now();
    ctx.emit("loader/volatile-update", [["nothingNonce"]]);
    await runs.queue(async () => void 0);
    assert.equal(launches, 1);
});
