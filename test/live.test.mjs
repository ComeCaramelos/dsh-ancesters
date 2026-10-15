/**
 * The live mirror — coalescing, the active-fiber rule, the emit path, and the
 * re-assert that keeps a refused write from erasing the answers.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createLiveMirror } from "../lib/host/adapter/live.js";
import { createPersister } from "../lib/host/adapter/persist.js";
import { fakeCtx, fakeEntry, fakeFiber, fakeSettings, tick } from "./helpers.mjs";

test("publishes coalesce: several answers in one run make one commit", async () => {
    const entry = fakeEntry({ keepMe: 1 });
    const ctx = fakeCtx({ fiber: fakeFiber(entry), settings: fakeSettings() });
    let values = {};
    const mirror = createLiveMirror(ctx, { read: () => values });
    values = { lastError: "boom" };
    mirror.publish();
    values = { ...values, chromeVersion: "1.2" };
    mirror.publish();
    await tick();
    assert.equal(entry.updates.length, 1, "one microtask, one commit");
    assert.deepEqual(entry.updates[0].next.config, { keepMe: 1, lastError: "boom", chromeVersion: "1.2" });
    assert.deepEqual([entry.updates[0].create, entry.updates[0].force], [false, false], "merge — never create, never force");
});

test("every published commit is followed by one cheap describe", async () => {
    const settings = fakeSettings();
    const entry = fakeEntry();
    const ctx = fakeCtx({ fiber: fakeFiber(entry), settings });
    let values = { a: 1 };
    const mirror = createLiveMirror(ctx, { read: () => values });
    mirror.publish();
    await tick();
    assert.equal(settings.calls.describes, 1);
    mirror.publish();
    await tick();
    assert.equal(settings.calls.describes, 2);
});

test("nothing to publish answers nothing — read undefined is silence, not a commit", async () => {
    const entry = fakeEntry();
    const ctx = fakeCtx({ fiber: fakeFiber(entry), settings: fakeSettings() });
    const mirror = createLiveMirror(ctx, { read: () => void 0 });
    mirror.publish();
    await tick();
    assert.equal(entry.updates.length, 0);
});

test("a publish issued before the fiber settles waits and lands after", async () => {
    const entry = fakeEntry();
    const fiber = fakeFiber(entry, { state: 1, awaiting: true });
    const ctx = fakeCtx({ fiber, settings: fakeSettings() });
    let values = { lastError: "late" };
    const mirror = createLiveMirror(ctx, { read: () => values });
    mirror.publish();
    await tick();
    assert.equal(entry.updates.length, 0, "not ACTIVE yet — a config update here would restart");
    await tick();
    assert.equal(entry.updates.length, 1);
});

test("a failed publish keeps the answers dirty and retries on the next publish", async () => {
    const entry = fakeEntry();
    entry.update = () => Promise.reject(new Error("write refused"));
    const ctx = fakeCtx({ fiber: fakeFiber(entry), settings: fakeSettings() });
    let values = { lastError: "one" };
    const mirror = createLiveMirror(ctx, { read: () => values });
    mirror.publish();
    await tick();
    assert.equal(ctx.logger.calls.warn.length, 1);
    // The answers were not lost: the next publish carries them.
    entry.update = fakeEntry().update;
    entry.update = function (next) {
        entry.updates.push(next);
        return Promise.resolve();
    };
    mirror.publish();
    await tick();
    assert.equal(entry.updates.length, 1);
    assert.deepEqual(entry.updates[0].config, { lastError: "one" });
});

test("a reset the host never made (another row persisted) re-asserts the mirror once", async () => {
    const entry = fakeEntry({ servers: [] });
    const ctx = fakeCtx({ fiber: fakeFiber(entry), settings: fakeSettings() });
    const values = { kinds: ["stdio", "chrome"], live: [] };
    const mirror = createLiveMirror(ctx, { read: () => values });
    mirror.publish();
    await tick();
    assert.equal(entry.updates.length, 1);
    // The mirror's own commit comes back as a volatile-update: it matches, so
    // nothing is published again — no loop.
    ctx.emit("loader/volatile-update", [["kinds"], ["live"]]);
    await tick();
    assert.equal(entry.updates.length, 1, "its own commit never republishes");
    // A recompose hands the entry its persisted config back: the live keys are
    // gone and the references went back to their defaults.
    entry.options.config = { servers: [] };
    ctx.emit("loader/volatile-update", [["kinds"]]);
    await tick();
    assert.equal(entry.updates.length, 2, "the cleared answers go straight back out");
    assert.deepEqual(entry.updates[1].next.config, { servers: [], kinds: ["stdio", "chrome"], live: [] });
    // A commit on a field the mirror does not own leaves an entry that still
    // carries the answers alone…
    ctx.emit("loader/volatile-update", [["actions"]]);
    await tick();
    assert.equal(entry.updates.length, 2, "nothing cleared, nothing published");
    // …but the update that clears them can name only the field the user saved
    // (dsh 0.2.1 lands a settings write as two updates): still re-asserted.
    entry.options.config = { servers: [{ id: "x" }] };
    ctx.emit("loader/volatile-update", [["servers"]]);
    await tick();
    assert.equal(entry.updates.length, 3, "a clear reported under another path is still caught");
    assert.deepEqual(entry.updates[2].next.config, { servers: [{ id: "x" }], kinds: ["stdio", "chrome"], live: [] });
});

test("a refused persist still re-asserts the mirror — live answers do not go quiet", async () => {
    const settings = fakeSettings({ mutateBehavior: "reject" });
    const form = { current: () => ({ entryId: "profile-entry", settings }) };
    let published = 0;
    const ctx = fakeCtx({ fiber: fakeFiber(fakeEntry()), settings });
    const persist = createPersister(ctx, { form, liveKeys: ["lastError"], publishLive: () => { published++; }, name: "srv" });
    await persist({ chromePath: "/x" });
    assert.equal(published, 1, "re-assert on the rejection side");
    assert.equal(ctx.logger.calls.warn.length, 1);
});

test("a successful persist clears every live key and re-asserts", async () => {
    const settings = fakeSettings();
    const form = { current: () => ({ entryId: "profile-entry", settings }) };
    let published = 0;
    const ctx = fakeCtx({ fiber: fakeFiber(fakeEntry()), settings });
    const persist = createPersister(ctx, { form, liveKeys: ["lastError", "chromeVersion"], publishLive: () => { published++; } });
    await persist({ extraFlags: ["--x"], chromePath: "/x" });
    const ops = settings.calls.mutates[0].ops;
    assert.deepEqual(ops.map((op) => op.op), ["set", "set", "unset", "unset"]);
    assert.deepEqual(ops[0].path, ["extraFlags"]);
    assert.deepEqual(ops[2].path, ["lastError"]);
    assert.equal(published, 1);
});

test("no form attached says so instead of inventing a write target", async () => {
    const ctx = fakeCtx({ fiber: fakeFiber(fakeEntry()), settings: fakeSettings() });
    const persist = createPersister(ctx, { form: { current: () => undefined }, liveKeys: [], publishLive: () => { throw new Error("must not publish for a non-write"); } });
    await persist({ extraFlags: ["--x"] });
    assert.match(ctx.logger.calls.warn[0], /not attached/);
});
