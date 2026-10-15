/**
 * The global registry — a keyed map whose identity lives on `globalThis`.
 *
 * Two dependency trees of the same package must read one map: a companion's
 * registration that lands in a private map is an entry that never runs. And an
 * id nothing registered answers a **reason**, never a silent default — a
 * default is how something starts running that nobody asked for.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createGlobalRegistry } from "../lib/host/registry.js";

test("registration order is the answer order, and one id one entry", () => {
    const registry = createGlobalRegistry(Symbol.for(`dsh-ancesters test ${Math.random()}`));
    const first = registry.register("first", { order: 1 });
    registry.register("second", { order: 2 });
    registry.register("third", { order: 3 });

    assert.deepEqual(registry.ids(), ["first", "second", "third"]);
    assert.deepEqual(registry.list().map((entry) => entry.order), [1, 2, 3]);
    assert.equal(registry.get("second").order, 2);

    first();
    assert.deepEqual(registry.ids(), ["second", "third"]);
});

test("a re-registration replaces, and the older owner cannot undo the newer", () => {
    const key = Symbol.for(`dsh-ancesters test ${Math.random()}`);
    const registry = createGlobalRegistry(key);
    const older = registry.register("one", { version: 1 });
    registry.register("one", { version: 2 });

    assert.equal(registry.get("one").version, 2);
    older();
    assert.equal(registry.get("one").version, 2, "the disposer must not remove a newer registration");

    registry.register("one", { version: 3 })();
    assert.equal(registry.get("one").version, 2, "a disposer hands the older answer back, it does not delete");
});

test("a disposer is idempotent and reports what it removed", () => {
    const registry = createGlobalRegistry(Symbol.for(`dsh-ancesters test ${Math.random()}`));
    const dispose = registry.register("x", {});
    dispose();
    dispose();
    assert.equal(registry.ids().length, 0);
});

test("resolving something unregistered answers a reason, not a default", () => {
    const registry = createGlobalRegistry(Symbol.for(`dsh-ancesters test ${Math.random()}`));
    const answer = registry.resolve("absent");
    assert.equal(answer.entry, undefined);
    assert.match(String(answer.answer), /nothing is registered|not registered/u);

    const custom = registry.resolve("absent", (id) => `nothing answers ${id}`);
    assert.equal(custom.answer, "nothing answers absent");
});

test("registering a bad key or an empty entry fails loudly", () => {
    const registry = createGlobalRegistry(Symbol.for(`dsh-ancesters test ${Math.random()}`));
    assert.throws(() => registry.register("", {}), TypeError);
    assert.throws(() => registry.register("nope", undefined), TypeError);
    assert.equal(registry.ids().length, 0);
});

test("two registries over the same global key share one map", () => {
    const key = Symbol.for(`dsh-ancesters test ${Math.random()}`);
    const one = createGlobalRegistry(key);
    const other = createGlobalRegistry(key);
    one.register("shared", { from: 1 });

    assert.equal(other.get("shared").from, 1);
    other.register("more", {});
    assert.deepEqual(one.ids(), ["shared", "more"]);
});

test("the map's identity is namespaced — a bare word would share with somebody else's map", () => {
    // The global half is the whole point of this module, and it is also the
    // whole risk: one bare word and two packages read one map by accident.
    assert.throws(() => createGlobalRegistry("kinds"), /namespaced/u);
    assert.throws(() => createGlobalRegistry(""), TypeError);
    assert.throws(() => createGlobalRegistry(7), TypeError);

    // A namespaced string answers the same way a `Symbol.for` does.
    const key = `dsh-ancesters test/${Math.random()}`;
    const one = createGlobalRegistry(key);
    const other = createGlobalRegistry(key);
    one.register("shared", { v: 1 });
    assert.equal(other.get("shared")?.v, 1);
    assert.equal(one.resolve("absent").answer, `nothing is registered under "absent"`);
});
