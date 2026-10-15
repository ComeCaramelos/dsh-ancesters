/**
 * `readVolatile` — one read path for the two shapes a `.volatile()` field
 * arrives as.
 *
 * cordis hands a profile row's volatile field to `apply` as a **live
 * reference**; anything built by hand hands the plain value. The consumer must
 * not care, and the returned array must always be a copy: a caller sorting or
 * filtering what it got must never edit the row through the back door.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { readVolatile } from "../lib/host/adapter/dsh.js";

test("a live reference answers what it carries", () => {
    let value = 7;
    const field = { get: () => value };
    assert.equal(readVolatile(field, 0), 7);
    value = 9;
    assert.equal(readVolatile(field, 0), 9, "the reference is read at call time, never captured");
});

test("a live reference that answers nothing falls back", () => {
    const fallback = [];
    assert.equal(readVolatile({ get: () => void 0 }, fallback), fallback);
    assert.equal(readVolatile({ get: () => null }, "none"), "none");
    assert.equal(readVolatile(void 0, fallback), fallback);
});

test("a plain value reads as itself", () => {
    assert.equal(readVolatile(3, 0), 3);
    assert.equal(readVolatile("x", ""), "x");
    assert.equal(readVolatile(false, true), false, "an explicit false is not 'nothing'");
});

test("arrays come back as a copy, so editing them cannot edit the source", () => {
    const source = [{ id: "one" }, { id: "two" }];
    const field = { get: () => source };
    const read = readVolatile(field, []);
    assert.notEqual(read, source);
    read.push({ id: "three" });
    assert.equal(source.length, 2);

    const given = [1, 2];
    const plain = readVolatile(given, []);
    assert.notEqual(plain, given);
    plain.push(3);
    assert.deepEqual(given, [1, 2]);
});

test("a reference that throws answers the fallback, never an exception", () => {
    const field = {
        get() {
            throw new Error("the row is mid-write");
        }
    };
    assert.deepEqual(readVolatile(field, []), []);
});

test("every container the read meets is a copy — a nested list included", () => {
    // The old read copied the top level only, so a live row's inner list could
    // still be edited through the value one was handed.
    const source = { lines: [{ id: "one" }], map: new Map([["a", 1]]), set: new Set(["a"]) };
    const read = readVolatile({ get: () => source }, void 0);
    assert.notEqual(read, source);
    assert.notEqual(read.lines, source.lines);
    assert.notEqual(read.map, source.map);
    assert.notEqual(read.set, source.set);
    assert.equal(read.lines[0].id, "one", "the leaves travel intact");

    read.lines.push({ id: "two" });
    read.map.set("b", 2);
    assert.equal(source.lines.length, 1, "the row's own list never grew");
    assert.equal(source.map.size, 1, "the row's own map never grew");
});

test("what is not a container is handed over as it stands", () => {
    // Copying a function or a class instance would be the surprise.
    const fn = () => "x";
    const instance = new Date(123);
    assert.equal(readVolatile({ get: () => fn }, void 0), fn);
    assert.equal(readVolatile({ get: () => instance }, void 0).getTime(), 123);
});

test("a key that answers nothing inside a held object is not carried along", () => {
    const read = readVolatile({ get: () => ({ a: 1, b: void 0, c: null }) }, void 0);
    assert.deepEqual(Object.keys(read).sort(), ["a"]);
});
