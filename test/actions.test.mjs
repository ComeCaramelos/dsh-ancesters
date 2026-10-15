/**
 * Trigger holes — the nonce idiom. A stored trigger folding in at boot must
 * never launch anything on its own; only a later diff fires.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { attachSettingsForm } from "../lib/host/adapter/form.js";
import { fakeCtx, fakeEntry, fakeFiber, fakeSettings } from "./helpers.mjs";

function ctxWithTriggers(values) {
    return fakeCtx({
        fiber: fakeFiber(fakeEntry()),
        settings: fakeSettings()
    });
}

test("the first fold of a stored trigger is swallowed — booting never launches", () => {
    const values = { refreshNonce: 171623 };
    const ctx = ctxWithTriggers(values);
    let fired = 0;
    attachSettingsForm(ctx, {
        userFields: ["refreshNonce"],
        readValue: (field) => values[field],
        actions: { refreshNonce: () => { fired++; } }
    });
    // The first commit carries the *stored* value: a diff against nothing is
    // the fold, not a request.
    ctx.emit("loader/volatile-update", [["refreshNonce"]]);
    assert.equal(fired, 0);
});

test("a later diff fires exactly once", () => {
    const values = { refreshNonce: 171623 };
    const ctx = ctxWithTriggers(values);
    let fired = 0;
    attachSettingsForm(ctx, {
        userFields: ["refreshNonce", "extraFlags"],
        readValue: (field) => values[field],
        actions: { refreshNonce: () => { fired++; } }
    });
    ctx.emit("loader/volatile-update", [["refreshNonce"]]);
    assert.equal(fired, 0);
    // A later commit touches another field: no diff on the trigger, nothing.
    ctx.emit("loader/volatile-update", [["extraFlags"]]);
    assert.equal(fired, 0);
    // The card writes `Date.now()` into the trigger: a diff stands.
    values.refreshNonce = 171624;
    ctx.emit("loader/volatile-update", [["refreshNonce"]]);
    assert.equal(fired, 1);
});

test("a trigger whose read answers nothing is a diff on the previous answer, not on noise", () => {
    const values = { openNonce: "" };
    const ctx = ctxWithTriggers(values);
    let fired = 0;
    attachSettingsForm(ctx, {
        userFields: ["openNonce"],
        readValue: (field) => values[field],
        actions: { openNonce: () => { fired++; } }
    });
    ctx.emit("loader/volatile-update", [["openNonce"]]);
    values.openNonce = "";
    ctx.emit("loader/volatile-update", [["openNonce"]]);
    assert.equal(fired, 0);
});

test("a throwing trigger does not break the commit routing", () => {
    const values = { nonce: 1 };
    const ctx = ctxWithTriggers(values);
    let routed = 0;
    attachSettingsForm(ctx, {
        userFields: ["nonce"],
        readValue: (field) => values[field],
        actions: { nonce: () => { throw new Error("run failed"); } },
        onCommit: () => { routed++; }
    });
    ctx.emit("loader/volatile-update", [["nonce"]]);
    values.nonce = 2;
    ctx.emit("loader/volatile-update", [["nonce"]]);
    // Every routed user commit reaches `onCommit` (the consumer decides what
    // a fold means); a throwing trigger must not skip the second routing.
    assert.equal(routed, 2);
});

/* ── hueco entryActions (host half): a keyed nonce answers per key ──────── */

/** A keyed nonce map: `writeEntryTrigger` writes stamps like these. */
function stamps(entries) {
    const value = {};
    for (const [key, stamp] of Object.entries(entries)) value[String(key)] = stamp;
    return value;
}

test("the first read of a stored keyed nonce folds in — booting launches no row", () => {
    const values = { entryNonce: stamps({ 0: 111, 1: 222 }) };
    const ctx = ctxWithTriggers(values);
    const fired = [];
    attachSettingsForm(ctx, {
        userFields: ["entryNonce"],
        readValue: (field) => values[field],
        actions: { entryNonce: (key) => fired.push(key) }
    });
    ctx.emit("loader/volatile-update", [["entryNonce"]]);
    assert.deepEqual(fired, []);
});

test("a keyed nonce diff fires one run per key that moved", () => {
    const values = { entryNonce: stamps({ 0: 111, 1: 222 }) };
    const ctx = ctxWithTriggers(values);
    const fired = [];
    attachSettingsForm(ctx, {
        userFields: ["entryNonce"],
        readValue: (field) => values[field],
        actions: { entryNonce: (key) => fired.push(key) }
    });
    ctx.emit("loader/volatile-update", [["entryNonce"]]);
    // Row 1 was stamped again; row 0 stands; a new row carries its first stamp.
    values.entryNonce = stamps({ 0: 111, 1: 223, 2: 333 });
    ctx.emit("loader/volatile-update", [["entryNonce"]]);
    assert.deepEqual(fired.sort(), ["1", "2"]);
});

test("a keyed key that disappears fires nothing — a dropped row asks for no run", () => {
    const values = { entryNonce: stamps({ 0: 111, 1: 222 }) };
    const ctx = ctxWithTriggers(values);
    const fired = [];
    attachSettingsForm(ctx, {
        userFields: ["entryNonce"],
        readValue: (field) => values[field],
        actions: { entryNonce: (key) => fired.push(key) }
    });
    ctx.emit("loader/volatile-update", [["entryNonce"]]);
    values.entryNonce = stamps({ 0: 111 });
    ctx.emit("loader/volatile-update", [["entryNonce"]]);
    assert.deepEqual(fired, []);
});

test("the keyed shape folds against itself: a map that merely re-reads fires nothing", () => {
    const values = { entryNonce: stamps({ a: 1 }) };
    const ctx = ctxWithTriggers(values);
    const fired = [];
    attachSettingsForm(ctx, {
        userFields: ["entryNonce"],
        readValue: (field) => values[field],
        actions: { entryNonce: (key) => fired.push(key) }
    });
    ctx.emit("loader/volatile-update", [["entryNonce"]]);
    ctx.emit("loader/volatile-update", [["entryNonce"]]);
    assert.deepEqual(fired, []);
});

test("the keyed diff rides every stamp kind: a number map is keyed, a bare number is scalar", () => {
    // A plain `Date.now()` nonce keeps its whole-value diff — the scalar idiom
    // is unchanged, keyed or not-keyed on the other side is still a diff.
    const values = { scalarNonce: 7 };
    const ctx = ctxWithTriggers(values);
    const fired = [];
    attachSettingsForm(ctx, {
        userFields: ["scalarNonce"],
        readValue: (field) => values[field],
        actions: { scalarNonce: (key) => fired.push(key === undefined ? "scalar" : key) }
    });
    ctx.emit("loader/volatile-update", [["scalarNonce"]]);
    values.scalarNonce = 8;
    ctx.emit("loader/volatile-update", [["scalarNonce"]]);
    assert.deepEqual(fired, ["scalar"]);
});
