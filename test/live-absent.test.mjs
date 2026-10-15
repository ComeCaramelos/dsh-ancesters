/**
 * The `liveKeys = ∅` shape — hover's card: everything editable, no mirror at
 * all. Two things had to hold, and this file pins them as API, not as an
 * accident of a loop: the form attaches with nothing declared to fold back,
 * and a persisted write carries **zero** `unset` ops — there is no live answer
 * to clear, and a write must never invent unsets it was never asked for.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { attachSettingsForm, createPersister } from "../lib/host/index.js";
import { fakeCtx, fakeEntry, fakeFiber, fakeSettings } from "./helpers.mjs";

test("the form attaches with liveKeys absent: every user commit routes", () => {
    const settings = fakeSettings();
    const ctx = fakeCtx({ fiber: fakeFiber(fakeEntry()), settings });
    const routed = [];
    const form = attachSettingsForm(ctx, {
        userFields: ["title", "url"],
        onCommit: (commit) => routed.push(commit.paths)
    });
    assert.deepEqual(form.liveKeys(), []);
    ctx.emit("loader/volatile-update", [["title"]]);
    assert.equal(routed.length, 1);
    // A path no user field names routes nothing — the rule still holds when
    // there is no mirror on the other side to keep it company.
    ctx.emit("loader/volatile-update", [["somethingElse"]]);
    assert.equal(routed.length, 1);
});

test("persistUser answers zero unsets when the card carries no mirror", async () => {
    const settings = fakeSettings();
    const ctx = fakeCtx({ fiber: fakeFiber(fakeEntry()), settings });
    const form = attachSettingsForm(ctx, { userFields: ["title"] });
    let published = 0;
    const persistUser = createPersister(ctx, { form, liveKeys: [], publishLive: () => { published++; } });
    await persistUser({ title: "hello" });
    assert.equal(settings.calls.mutates.length, 1);
    const ops = settings.calls.mutates[0].ops;
    assert.equal(ops.filter((op) => op.op === "unset").length, 0);
    assert.deepEqual(ops.filter((op) => op.op === "set"), [{ op: "set", path: ["title"], value: "hello" }]);
    assert.equal(published, 1);
});

test("liveKeys may be omitted entirely — the persister clears nothing by default", async () => {
    const settings = fakeSettings();
    const ctx = fakeCtx({ fiber: fakeFiber(fakeEntry()), settings });
    const form = attachSettingsForm(ctx, { userFields: ["url"] });
    const persistUser = createPersister(ctx, { form, publishLive: () => void 0 });
    await persistUser({ url: "https://example" });
    const ops = settings.calls.mutates[0].ops;
    assert.equal(ops.every((op) => op.op === "set"), true);
});
