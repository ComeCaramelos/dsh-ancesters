/**
 * `toolNamesByNamespace` — the registry view filtered by one namespace.
 *
 * "Which tools does this server really serve?" is answered by filtering the
 * shell's registry by `mcp__<namespace>__`, never by asking the server. A
 * registry that will not answer is not a failure of the connection: the answer
 * is no tools, not a throw.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { toolNamespaceOf, toolNamesByNamespace } from "../lib/host/adapter/tools.js";

/** A context whose `tools` service answers what it is told to. */
function contextWith(schemas) {
    return { get: (name) => (name === "tools" ? { schemas: () => schemas } : void 0) };
}

test("the names under one namespace come back sorted", () => {
    const names = toolNamesByNamespace(
        contextWith([
            { name: "mcp__fs__write" },
            { name: "mcp__fs__read" },
            { name: "mcp__db__query" },
            { name: "core__search" }
        ]),
        "fs"
    );
    assert.deepEqual(names, ["mcp__fs__read", "mcp__fs__write"]);
});

test("a namespace is matched whole, not as a substring of another", () => {
    assert.equal(toolNamespaceOf("mcp__fsx__read", "fs"), false);
    assert.equal(toolNamespaceOf("mcp__fs__read", "fs"), true);
    assert.equal(toolNamespaceOf("read", "fs"), false);
    assert.equal(toolNamesByNamespace(contextWith([{ name: "mcp__fsx__read" }]), "fs").length, 0);
});

test("a registry that answers nothing answers no tools", () => {
    assert.deepEqual(toolNamesByNamespace({ get: () => void 0 }, "fs"), []);
    assert.deepEqual(toolNamesByNamespace({ get: () => ({}) }, "fs"), []);
    assert.deepEqual(
        toolNamesByNamespace({
            get: () => ({
                schemas() {
                    throw new Error("the registry is not ready");
                }
            })
        }, "fs"),
        []
    );
});

test("a surface that does not answer is named once — no tools and a moved surface are different answers", () => {
    const lines = [];
    const ctx = { logger: { warn: (line) => lines.push(String(line)) }, get: () => void 0 };
    assert.deepEqual(toolNamesByNamespace(ctx, "fs"), []);
    assert.equal(lines.length, 1, "the shout goes out when the read cannot say what the server serves");
    assert.match(lines[0], /did not answer/u);
    // Repeated reads on one surface never repeat the shout.
    toolNamesByNamespace(ctx, "fs");
    toolNamesByNamespace(ctx, "fs");
    assert.equal(lines.length, 1);

    // A registry that throws is named too — it is not "no tools", it is no answer.
    const thrown = [];
    const throwing = {
        logger: { warn: (line) => thrown.push(String(line)) },
        get: () => ({
            schemas() {
                throw new Error("the registry is not ready");
            }
        })
    };
    assert.deepEqual(toolNamesByNamespace(throwing, "fs"), []);
    assert.equal(thrown.length, 1);
    assert.match(thrown[0], /not ready|threw/u);
});

test("odd shapes in the registry never break the filter", () => {
    const names = toolNamesByNamespace(contextWith([{ name: 7 }, {}, null, { name: "mcp__a__x" }]), "a");
    assert.deepEqual(names, ["mcp__a__x"]);
});
