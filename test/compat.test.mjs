/**
 * Compatibility — feature-detect the surface, never the version number
 * (contratos-dsh §9). A surface that exists with the wrong shape fails loud,
 * with a named error; the package never silently defaults against a half-built
 * host.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { supportsSettingsForms, requireSettingsForms } from "../lib/host/adapter/dsh.js";
import { attachSettingsForm } from "../lib/host/adapter/form.js";
import { fakeCtx, fakeEntry, fakeFiber, fakeSettings } from "./helpers.mjs";

test("shape answers for the settings service, not the version string", () => {
    assert.equal(supportsSettingsForms(fakeSettings()), true);
    assert.equal(supportsSettingsForms({ describe: () => [], configure: () => void 0 }), false, "no mutate");
    assert.equal(supportsSettingsForms({ describe: () => [], mutate: () => void 0 }), false, "no configure");
    assert.equal(supportsSettingsForms({ configure: () => void 0, mutate: () => void 0 }), false, "no describe");
    assert.equal(supportsSettingsForms(undefined), false);
    assert.equal(supportsSettingsForms(null), false);
    assert.equal(supportsSettingsForms("settings"), false);
});

test("a half-built surface answers with a named, actionable error", () => {
    assert.throws(() => requireSettingsForms({ describe: () => [] }), (error) => {
        assert.equal(error instanceof TypeError, true);
        assert.match(error.message, /this dsh build is not supported/);
        assert.match(error.message, /describe/);
        return true;
    });
});

test("an attached form keeps running when the service is absent — loud stays the only difference", () => {
    // No settings service at all: the row still routes nothing (there is no
    // document to change) and everything else the host does keeps working.
    const ctx = fakeCtx({ fiber: fakeFiber(fakeEntry()), settings: undefined });
    const form = attachSettingsForm(ctx, { userFields: ["extraFlags"] });
    assert.equal(form.current().entryId, "profile-entry");
    assert.equal(form.current().settings, undefined);
});

test("a half-shaped service is loud once and must not break the instance", () => {
    const ctx = fakeCtx({
        fiber: fakeFiber(fakeEntry()),
        settings: { describe: () => [] }
    });
    const form = attachSettingsForm(ctx, { userFields: [] });
    assert.equal(ctx.logger.calls.error.length, 1);
    assert.match(ctx.logger.calls.error[0], /this dsh build is not supported/);
    assert.equal(form.current().settings, undefined);
});

/**
 * The published compatibility stance: `engines.dsh` is the promise — the field
 * dsh's own compatibility check reads — and feature detection is the guard. A
 * version-string comparison (`version === "0.2.0"`) would be wrong on every
 * patch of the same minor. The `-0` floor is what lets the 0.2 release
 * candidates in: `^0.2.0` alone stops at `0.2.0` and refuses `0.2.0-rc.2`.
 */
test("the package promises a dsh range, not a pinned build", async () => {
    const { readFile } = await import("node:fs/promises");
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    assert.equal(pkg.engines.dsh, "^0.2.0-0");
    assert.equal(pkg.engines.dshRange, undefined, "dsh never reads `dshRange`; one field, the one it reads");
});
