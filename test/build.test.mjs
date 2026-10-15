/**
 * Build outputs: every export-map member resolves to a real emitted file, and
 * the emitted surfaces carry exactly the names their hand-written `.d.ts`
 * declares — the export map is public contract with semver, so a member that
 * emits nothing (or names something else) is a break.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Names a hand-written surface declares (`export declare function X` / `const`). */
function declaredNames(dtsSource) {
    const names = [];
    for (const match of dtsSource.matchAll(/export declare (?:function|const) ([A-Za-z0-9_]+)/g)) {
        names.push(match[1]);
    }
    return names.sort();
}

const PLAIN_BUNDLES = {
    "lib/blocks.js": "lib/blocks.d.ts",
    "lib/styles.js": "lib/styles.d.ts",
    "lib/locales.js": "lib/locales.d.ts"
};

test("every export-map member emits its file", async () => {
    const pkg = JSON.parse(await readFile(resolve(ROOT, "package.json"), "utf8"));
    for (const [subpath, target] of Object.entries(pkg.exports)) {
        if (subpath === "./package.json") continue;
        for (const kind of ["types", "default"]) {
            if (typeof target === "string") {
                await readFile(resolve(ROOT, target)); // throws if missing
            } else if (target[kind]) {
                await readFile(resolve(ROOT, target[kind]));
            }
        }
    }
});

test("plain bundles carry exactly the names their d.ts declares", async () => {
    for (const [bundle, dts] of Object.entries(PLAIN_BUNDLES)) {
        const source = await readFile(resolve(ROOT, bundle), "utf8");
        const declared = declaredNames(await readFile(resolve(ROOT, dts), "utf8"));
        for (const name of declared) {
            assert.match(source, new RegExp(`\\b${name}\\b`), `${bundle} should carry "${name}"`);
        }
    }
});

test("locales dictionary keys are shared-card keys only (no plugin domains)", async () => {
    const source = await readFile(resolve(ROOT, "src/client/locales/index.ts"), "utf8");
    for (const banned of ["chrome", "gateway", "docker", "executable", "hover"]) {
        assert.doesNotMatch(source, new RegExp(`"${banned}\\w*"`, "i"), `locale key for "${banned}" is domain, not shared`);
    }
});
