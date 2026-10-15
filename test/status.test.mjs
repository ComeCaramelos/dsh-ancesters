/**
 * Error classification — shared defaults plus a consumer's own classifier.
 *
 * The known "no executable detected" families are the ones all three reference
 * checkouts agreed on; the persistence rule behind them (only *evidence* clears
 * a known error) belongs to the card that writes the mirror, not to this half.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { firstLine, isExecutableMissing, toolResultNote } from "../lib/host/status.js";

test("firstLine takes the first non-empty line, capped", () => {
    assert.equal(firstLine("\n\n  boom  \nsecond"), "boom");
    assert.equal(firstLine(""), "");
    assert.equal(firstLine("x".repeat(50), 10), "x".repeat(10));
    assert.equal(firstLine(undefined), "");
});

test("the known state is recognized across its upstream spellings", () => {
    for (const message of [
        "chrome executable not found",
        "Could not find Google Chrome executable for channel 'stable' at:",
        "Executable could not be found",
        "browser was not found at the configured executablePath",
        "failed to launch the browser process",
        "spawn /usr/bin/whatever ENOENT"
    ]) {
        assert.equal(isExecutableMissing(message), true, message);
    }
    for (const message of [
        "connection refused",
        "Target closed",
        "timed out after 3000ms",
        ""
    ]) {
        assert.equal(isExecutableMissing(message), false, message);
    }
});

test("a consumer extends the known families through the hook, not a shared if", () => {
    const rules = { knownErrors: [/^my-domain-nothing-here$/iu] };
    assert.equal(isExecutableMissing("my-domain-nothing-here", rules), true);
    assert.equal(isExecutableMissing("connection refused", rules), false);
});

test("a consumer may own the whole classification", () => {
    const rules = { classify: (message) => (/noice/iu.test(message) ? "executableMissing" : null) };
    assert.equal(isExecutableMissing("NOICE: whatever", rules), true);
    assert.equal(isExecutableMissing("spawn ENOENT", rules), false);
});

test("toolResultNote summarizes a failure and answers null on success", () => {
    assert.equal(toolResultNote("mcp__srv__tool", { isError: false, content: [] }), null);
    assert.equal(toolResultNote("mcp__srv__tool", null), null);

    const failed = {
        isError: true,
        content: [{ type: "text", text: "Target closed\nsecond line" }]
    };
    assert.equal(toolResultNote("mcp__srv__tool", failed), "tool failed: Target closed");

    // Tool-level errors can also ride the error object instead of content.
    const errored = { isError: true, content: [], error: { message: "browser unreachable" } };
    assert.equal(toolResultNote("mcp__srv__x__thing", errored), "thing failed: browser unreachable");

    // Nothing at all: say so rather than emit an empty line.
    const bare = { isError: true, content: [] };
    assert.equal(toolResultNote("mcp__srv__tool", bare), "tool failed: unknown error");
});

test("classification caps at the shared length", () => {
    const note = toolResultNote("t__x", { isError: true, content: [{ type: "text", text: "y".repeat(500) }] });
    assert.ok(note.length <= 200);
});
