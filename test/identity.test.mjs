/**
 * Identity rules — `requireEntryId` / `rowConfigKey`.
 *
 * The row slot key is *derived*, never identity (contratos-dsh §1): two
 * instances that invent their own key would silently alias. And a bare mount
 * that cannot read a profile id must say so loudly — inventing a key would
 * "work" by addressing nothing.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { requireEntryId, rowConfigKey } from "../lib/host/index.js";

test("requireEntryId reads the id off the fiber's own loader entry", () => {
    const ctx = { fiber: { entry: { options: { id: "chrome#1" } } } };
    assert.equal(requireEntryId(ctx), "chrome#1");
});

test("requireEntryId fails loud without a profile id — never invents a key", () => {
    for (const ctx of [
        {},
        { fiber: {} },
        { fiber: { entry: {} } },
        { fiber: { entry: { options: {} } } },
        { fiber: { entry: { options: { id: "" } } } },
        { fiber: { entry: { options: { id: 7 } } } }
    ]) {
        assert.throws(() => requireEntryId(ctx), /not a profile entry/, `ctx=${JSON.stringify(ctx)}`);
    }
});

test("rowConfigKey is derived from package + entry id, never guessed", () => {
    assert.equal(rowConfigKey("@comecaramelos/dsh-chrome-mcp", "chrome#1"),
        "@comecaramelos/dsh-chrome-mcp#chrome#1");
});

test("rowConfigKey rejects the identities it cannot derive from", () => {
    assert.throws(() => rowConfigKey("", "x"), /package name/);
    assert.throws(() => rowConfigKey("p", ""), /entry id/);
});
