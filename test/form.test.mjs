/**
 * `attachSettingsForm` — identity, dispose, routing.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { attachSettingsForm, readFormRow, routesUserCommit } from "../lib/host/adapter/form.js";
import { fakeCtx, fakeEntry, fakeFiber, fakeSettings, tick } from "./helpers.mjs";

/** A context whose fiber carries a profile entry id. */
function ctxWithEntry(settings = fakeSettings()) {
    return { ctx: fakeCtx({ fiber: fakeFiber(fakeEntry()), settings }), settings };
}

test("identity comes from the fiber's own profile entry id", () => {
    const { ctx } = ctxWithEntry();
    const form = attachSettingsForm(ctx, { userFields: ["extraFlags"] });
    assert.equal(form.current().entryId, "profile-entry");
    assert.equal(form.attached(), true);
});

test("not a profile entry fails loud — it does not invent a key", () => {
    const ctx = fakeCtx({ fiber: fakeFiber({ options: { config: {} } }), settings: fakeSettings() });
    const form = attachSettingsForm(ctx, { userFields: ["extraFlags"] });
    assert.equal(form.current(), undefined);
    assert.equal(form.attached(), false);
    assert.equal(ctx.logger.calls.error.length, 1);
    assert.match(ctx.logger.calls.error[0], /not a profile entry/);
});

test("the auto page is turned off once per fiber and disposed with the effect", () => {
    const { ctx, settings } = ctxWithEntry();
    const form = attachSettingsForm(ctx, { userFields: ["extraFlags"] });
    assert.equal(form.current().settings, settings);
    assert.equal(settings.calls.configures.filter((call) => call.disposed !== true).length, 1);
    ctx.disposeAll();
    assert.equal(form.current(), undefined);
    assert.equal(settings.calls.configures.some((call) => call.disposed === true), true);
});

test("the attach hole hears the form stand up (id first, then the service) and the detach hole hears it leave", () => {
    const { ctx, settings } = ctxWithEntry();
    const attached = [];
    let detached = 0;
    attachSettingsForm(ctx, {
        userFields: [],
        onAttach: (form) => attached.push({ entryId: form.entryId, settings: form.settings }),
        onDetach: () => {
            detached++;
        }
    });
    assert.deepEqual(attached.map((form) => form.entryId), ["profile-entry", "profile-entry"]);
    assert.equal(attached[0].settings, undefined, "the id alone stands first");
    assert.equal(attached[1].settings, settings, "then the service it writes through");
    assert.equal(detached, 0);
    ctx.disposeAll();
    assert.equal(detached, 1, "and it leaves with the instance");
});

test("a row's described document is read by its namespace, and a cold or failing service answers undefined", () => {
    const rows = [{ ns: "other", user: {} }, { ns: "mcp-chrome", user: { extraFlags: ["--x"] }, base: {} }];
    assert.deepEqual(readFormRow({ describe: () => rows }, "mcp-chrome"), rows[1]);
    assert.equal(readFormRow({ describe: () => rows }, "missing"), undefined, "a row nothing describes");
    assert.equal(readFormRow(undefined, "mcp-chrome"), undefined, "no service yet");
    assert.equal(readFormRow({ describe: () => { throw new Error("not ready"); } }, "mcp-chrome"), undefined, "a service that cannot answer");
    assert.equal(readFormRow({ describe: () => "nonsense" }, "mcp-chrome"), undefined, "an answer that is not a list");
});

test("two sequential mounts leave nothing configuring behind", () => {
    const first = ctxWithEntry();
    attachSettingsForm(first.ctx, { userFields: [] });
    first.ctx.disposeAll();
    const second = fakeCtx({ fiber: first.ctx.fiber, settings: first.settings });
    attachSettingsForm(second, { userFields: [] });
    assert.equal(second.logger.calls.error.length, 0);
    assert.equal(second.logger.calls.warn.length, 0);
});

test("a second configure for one fiber throws — loudly, without breaking the form", () => {
    // The service answers the first configure normally and throws on any
    // further configure for the same fiber: exactly what an HMR reload that
    // disposed nothing would hit.
    let calls = 0;
    const settings = fakeSettings();
    settings.configure = (presentation) => {
        calls++;
        if (calls > 1) throw new Error("configure: already configured for this fiber");
        return () => void 0;
    };
    const ctx = fakeCtx({ fiber: fakeFiber(fakeEntry()), settings });
    const form = attachSettingsForm(ctx, { userFields: [] });
    assert.equal(form.current().settings, settings);
    // Mount the same fiber a second time without disposing the first.
    attachSettingsForm(ctx, { userFields: [] });
    assert.equal(ctx.logger.calls.warn.length, 1);
    assert.equal(form.current() !== undefined, true);
});

test("commits route only for user-authored fields", () => {
    const ctx = fakeCtx({ fiber: fakeFiber(fakeEntry()), settings: fakeSettings() });
    const routed = [];
    attachSettingsForm(ctx, {
        userFields: ["extraFlags", "chromePath"],
        liveKeys: ["lastError", "chromeVersion"],
        onCommit: (commit) => routed.push(commit.paths)
    });
    // A live-only commit: routes nothing (that filter is the no-echo rule).
    ctx.emit("loader/volatile-update", [["lastError"], ["chromeVersion"]]);
    assert.equal(routed.length, 0);

    ctx.emit("loader/volatile-update", [["extraFlags", "1"]]);
    assert.equal(routed.length, 1);
    assert.deepEqual(routed[0], [["extraFlags", "1"]]);
});

test("routesUserCommit answers on the first path segment, at any depth", () => {
    const user = new Set(["executables"]);
    assert.equal(routesUserCommit([["executables", "2", "name"]], user), true);
    assert.equal(routesUserCommit([["lastError"]], user), false);
    assert.equal(routesUserCommit([["executables"], ["lastError"]], user), true);
    assert.equal(routesUserCommit([], user), false);
});

test("the describe hook answers once the service is attached", async () => {
    const ctx = fakeCtx({ fiber: fakeFiber(fakeEntry()), settings: fakeSettings() });
    let documents = null;
    attachSettingsForm(ctx, { userFields: [], describe: (docs) => { documents = docs; } });
    assert.ok(Array.isArray(documents));
    assert.equal(documents[0].entryId, "profile-entry");
});
