/**
 * `sameValue` / `stableKey` — one diff rule for both halves.
 *
 * The whole point is that object key **order** never reads as a change while
 * array order always does: a host that re-serializes a map the other way round
 * must not show a card a field that never moved, and an argument list whose
 * items swapped must never look unchanged.
 */
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import { sameValue, stableKey } from "../lib/host/values.js";

test("two serializations of the same map with a different key order are equal", () => {
    const left = { command: "node", args: ["-y", "s"], env: { PATH: "/usr/bin", TZ: "UTC" } };
    const right = { env: { TZ: "UTC", PATH: "/usr/bin" }, args: ["-y", "s"], command: "node" };
    assert.equal(sameValue(left, right), true);
    assert.equal(stableKey(left), stableKey(right));
});

test("array order is a change", () => {
    assert.equal(sameValue({ args: ["a", "b"] }, { args: ["b", "a"] }), false);
    assert.equal(sameValue({ args: [] }, { args: [] }), true);
});

test("`undefined` and `null` land together, and an unset key is the same", () => {
    assert.equal(sameValue({ cwd: void 0 }, { cwd: null }), true);
    assert.equal(stableKey({ cwd: void 0 }), stableKey({}));
    assert.equal(stableKey(void 0), "null");
});

test("a missing key against a present one is a change; one answering nothing is not", () => {
    // A key standing with nothing in it is the same answer as that key not
    // standing: both primitives say so, which is the rule that keeps a Host
    // re-serializing a map from looking like a moved field.
    assert.equal(sameValue({ a: 1, b: 2 }, { a: 1 }), false);
    assert.equal(sameValue({ a: 1 }, { a: 1, b: undefined }), true);
    assert.equal(stableKey({ a: 1 }) === stableKey({ a: 1, b: undefined }), true);
    assert.equal(sameValue({ a: 1 }, { a: 1, b: null }), true);
    assert.equal(sameValue({ a: 1 }, { a: 1, b: null }), true);
});

test("a value built in another realm compares by what it is, not by who built it", async () => {
    // The loader evaluates blocks in their own realm, and the Host hands values
    // built anywhere else: `instanceof` would read a foreign `Date` as moved,
    // and a foreign record as not a record.
    const record = vm.runInNewContext("({ command: 'node', args: ['a'] })");
    assert.equal(sameValue(record, { command: "node", args: ["a"] }), true);
    assert.equal(sameValue(record, { command: "node", args: ["b"] }), false);

    const map = vm.runInNewContext("new Map([['x', 1]])");
    assert.equal(sameValue(map, new Map([["x", 1]])), true);
    assert.equal(stableKey(map), stableKey(new Map([["x", 1]])));

    const set = vm.runInNewContext("new Set(['b', 'a'])");
    assert.equal(sameValue(set, new Set(["a", "b"])), true);

    const date = vm.runInNewContext("new Date(123)");
    assert.equal(sameValue(date, new Date(123)), true);

    const boxed = vm.runInNewContext("new String('x')");
    assert.equal(sameValue(boxed, new String("x")), true);
});

test("a value that is not a map or a list compares by what it is", () => {
    assert.equal(sameValue(new Date(1), new Date(2)), false, "a moved instant is a change");
    assert.equal(sameValue(new Date(5), new Date(5)), true);
    assert.equal(sameValue({ when: new Date(1) }, { when: new Date(2) }), false);
    assert.equal(sameValue(new Map([[1, 2]]), new Map([[1, 2]])), true);
    assert.equal(sameValue(new Map([[1, 2]]), new Map([[1, 3]])), false);
    assert.equal(sameValue(new Set([1]), new Set([2])), false);
    assert.equal(sameValue(/a/g, /a/g), true);
    assert.equal(sameValue(/a/g, /a/i), false);
    assert.equal(stableKey(new Map([[1, 2]])) !== stableKey({}), true);
});

test("scalars compare by value and NaN never reads as a drift", () => {
    assert.equal(sameValue(1, 1), true);
    assert.equal(sameValue(1, "1"), false);
    assert.equal(sameValue(Number.NaN, Number.NaN), true);
    assert.equal(sameValue(void 0, null), true, "an unset field and a null field answer the same thing");
});

test("nested maps compare the same way as top-level ones", () => {
    const left = { servers: [{ id: "one", extra: { profile: "x", mode: "y" } }] };
    const right = { servers: [{ extra: { mode: "y", profile: "x" }, id: "one" }] };
    assert.equal(sameValue(left, right), true);
    assert.equal(stableKey(left), stableKey(right));
});
