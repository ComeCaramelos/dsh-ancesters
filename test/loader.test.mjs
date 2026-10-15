/**
 * The emitted `lib/client.js` must materialize in a bare `node:vm` against the
 * shell's loader contract (`window.__ModuleLoader__.load({ id, factory })`),
 * exactly like the reference checkouts' halves do, and a bare `apply()` call
 * must fail *controlled* — a clear error, never a silent crash or a TypeError.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Stand the bundle up in a sandbox that provides only what the shell provides.
 * @returns the exports of the loader's `factory` return value.
 */
async function materialize(externals = {}) {
    const source = await readFile(resolve(ROOT, "lib/client.js"), "utf8");
    const registered = {};
    const sandbox = {
        window: {
            __ModuleLoader__: {
                load(spec) {
                    registered[spec.id] = spec.factory;
                }
            }
        },
        // Baseline modules the shell seeds; the bundle requires them through
        // the factory's `require`, so the sandbox needs to answer them.
        require(id) {
            if (id in externals) return externals[id];
            throw new Error(`unknown module: ${id}`);
        }
    };
    vm.runInNewContext(source, sandbox, { filename: "lib/client.js" });
    return { registered, sandbox };
}

test("registers under the ancestor id — unique, so consumers can pair it", async () => {
    const { registered } = await materialize();
    assert.deepEqual(Object.keys(registered), ["@comecaramelos/dsh-ancesters/client"]);
});

test("apply() without arguments fails controlled, not crashed", async () => {
    const { registered } = await materialize();
    const exports = registered["@comecaramelos/dsh-ancesters/client"]((id) => {
        // The baseline modules the shell seeds: only needed at render time,
        // never during materialization.
        if (id === "react") return { useState: () => [void 0, () => {}] };
        if (id === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
        if (id === "@deepseek-ai/dsh-client-ui-primitives") return { Menu: () => null, Switch: () => null };
        if (id === "@deepseek-ai/dsh-client-store") {
            return {
                createSnapshotStore(initial) {
                    let value = initial;
                    return { subscribe: () => () => {}, getSnapshot: () => value, set: (next) => { value = next; } };
                }
            };
        }
        throw new Error(`unknown module: ${id}`);
    });
    assert.equal(typeof exports.mountSettingsCard, "function");
    assert.equal(typeof exports.apply, "function");
    assert.ok(Array.isArray(exports.inject));

    // `apply` mounts nothing without a descriptor: controlled, named error.
    assert.throws(() => exports.apply(), /mountSettingsCard/);

    // The mounted body, applied without the shell surfaces behind it, still
    // says so with a named error rather than crashing on a missing surface.
    const card = exports.mountSettingsCard({ entryId: "x", pluginId: "y", localeNamespace: "z" });
    assert.throws(() => card.apply({}), /browser plugin context/);
});
