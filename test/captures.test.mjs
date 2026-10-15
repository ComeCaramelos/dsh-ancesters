/**
 * The two capture paths — the logger wrapper and the settled tool call.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { captureBridgeLog, captureToolResults, formatLogArgs } from "../lib/host/captures.js";
import { fakeCtx, fakeEntry, fakeFiber } from "./helpers.mjs";

test("the logger wrapper answers before the original and passes the original through", () => {
    const baseCalls = [];
    const base = {
        warn(...args) {
            baseCalls.push(["warn", args]);
            return "warn";
        },
        error(...args) {
            baseCalls.push(["error", args]);
            return "error";
        }
    };
    const lines = [];
    const wrapped = captureBridgeLog(base, (line) => lines.push(line));
    assert.equal(wrapped.warn("boom", 1), "warn");
    assert.deepEqual(lines, [{ level: "warn", message: "boom 1" }]);
    assert.deepEqual(baseCalls, [["warn", ["boom", 1]]]);
});

test("the wrapper never hides the logger's own surface", () => {
    const base = { warn: () => 1, debug: () => 2, custom: () => 3 };
    const wrapped = captureBridgeLog(base, () => {});
    assert.equal(wrapped.custom(), 3);
    assert.equal(typeof wrapped.debug, "function");
});

test("formatLogArgs spells errors with their stack", () => {
    const error = new Error("nope");
    const text = formatLogArgs(["prefix", error]);
    assert.match(text, /prefix Error: nope/);
});

function toolCaptureCtx() {
    const handlers = new Map();
    const ctx = fakeCtx({ fiber: fakeFiber(fakeEntry()) });
    ctx.on = (event, handler) => {
        handlers.set(event, handler);
        return () => handlers.delete(event);
    };
    return { ctx, handlers };
}

test("a failed tool call this host owns surfaces as a note", async () => {
    const { ctx, handlers } = toolCaptureCtx();
    const seen = [];
    captureToolResults(ctx, { prefix: "mcp__srv__", onResult: (note, name) => seen.push([note, name]) });

    const handler = handlers.get("tools/post-execute");
    assert.equal(typeof handler, "function");
    await handler(
        { name: "mcp__srv__thing" },
        { isError: true, content: [{ type: "text", text: "Target closed\nsecond" }] },
        () => "next"
    );
    assert.deepEqual(seen, [["thing failed: Target closed", "mcp__srv__thing"]]);
});

test("a success answers null so the consumer clears what stands", async () => {
    const { ctx, handlers } = toolCaptureCtx();
    const seen = [];
    captureToolResults(ctx, { prefix: "mcp__srv__", onResult: (note) => seen.push(note) });
    await handlers.get("tools/post-execute")({ name: "mcp__srv__thing" }, { isError: false, content: [] }, () => 1);
    assert.deepEqual(seen, [null]);
});

test("an unrelated tool answers nothing", async () => {
    const { ctx, handlers } = toolCaptureCtx();
    const seen = [];
    captureToolResults(ctx, { prefix: "mcp__srv__", onResult: () => seen.push("seen") });
    await handlers.get("tools/post-execute")({ name: "mcp__other__thing" }, { isError: true, content: [] }, () => 1);
    assert.deepEqual(seen, []);
});

test("a capture fault never breaks a tool call", async () => {
    const { ctx, handlers } = toolCaptureCtx();
    captureToolResults(ctx, { prefix: "mcp__srv__", onResult: () => { throw new Error("capture broke"); } });
    const nexted = await handlers.get("tools/post-execute")({ name: "mcp__srv__thing" }, { isError: true, content: [] }, () => "passed through");
    assert.equal(nexted, "passed through");
    assert.equal(ctx.logger.calls.warn.length, 1);
});

test("the tool capture disposes", async () => {
    const { ctx, handlers } = toolCaptureCtx();
    const dispose = captureToolResults(ctx, { prefix: "mcp__srv__", onResult: () => {} });
    dispose();
    assert.equal(handlers.has("tools/post-execute"), false);
});

/* ── hueco ND1: one match for many namespaces ─────────────────────────── */

test("the match is public surface: one prefix, a set, or a predicate", async () => {
    const surface = await import("../lib/host/index.js");
    assert.equal(typeof surface.matchesToolName, "function");
    assert.equal(surface.matchesToolName("mcp__a__x", "mcp__a__"), true);
    assert.equal(surface.matchesToolName("mcp__b__x", "mcp__a__"), false);
    assert.equal(surface.matchesToolName("mcp__a__x", new Set(["mcp__a__", "mcp__b__"])), true);
    assert.equal(surface.matchesToolName("mcp__c__x", new Set(["mcp__a__", "mcp__b__"])), false);
    assert.equal(surface.matchesToolName("mcp__c__x", new Set()), false);
    assert.equal(surface.matchesToolName("mcp__c__x", (name) => name.startsWith("mcp__c")), true);
    // A predicate that throws matches nothing: a capture never changes what runs.
    assert.equal(surface.matchesToolName("mcp__c__x", () => { throw new Error("boom"); }), false);
});

test("one capture for N namespaces answers every row", async () => {
    const { ctx, handlers } = toolCaptureCtx();
    const seen = [];
    captureToolResults(ctx, { prefix: new Set(["mcp__one__", "mcp__two__"]), onResult: (note, name) => seen.push([note, name]) });
    const handler = handlers.get("tools/post-execute");
    await handler({ name: "mcp__one__tool" }, { isError: true, content: [{ type: "text", text: "first failed" }] }, () => 1);
    await handler({ name: "mcp__two__tool" }, { isError: false, content: [] }, () => 1);
    await handler({ name: "mcp__other__tool" }, { isError: true, content: [] }, () => 1);
    assert.deepEqual(seen, [["tool failed: first failed", "mcp__one__tool"], [null, "mcp__two__tool"]]);
});

test("a predicate match captures by name, and its faults do not break the call", async () => {
    const { ctx, handlers } = toolCaptureCtx();
    const seen = [];
    captureToolResults(ctx, { prefix: (name) => name.startsWith("mcp__srv__thing"), onResult: (note, name) => seen.push([note, name]) });
    const handler = handlers.get("tools/post-execute");
    await handler({ name: "mcp__srv__thing_x" }, { isError: true, content: [{ type: "text", text: "nope" }] }, () => "next");
    await handler({ name: "mcp__srv__other" }, { isError: true, content: [{ type: "text", text: "nope" }] }, () => "next");
    assert.deepEqual(seen, [["thing_x failed: nope", "mcp__srv__thing_x"]]);
});
