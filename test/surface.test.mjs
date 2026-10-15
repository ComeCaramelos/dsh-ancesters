/**
 * Surface rule — only the adapter layer touches a dsh surface.
 *
 * Blocks, styles, locales and primitives receive *data + callbacks*, never the
 * services themselves, so one dsh break moves files under `adapter/` (host) and
 * `apply`/`controller` (client) and never touches the widget halves.
 *
 * The grep is deliberately wider than a build failure would be: it asks about
 * names, so a file that reaches for a surface the build would happily resolve
 * still fails.
 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Recursively list every source file below `dir`, with its path relative to root. */
async function sources(dir, base = dir, out = []) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            await sources(path, base, out);
        } else if (entry.isFile() && entry.name.endsWith(".ts")) {
            out.push({ file: path, relative: path.slice(resolve(ROOT).length + 1).replace(/\\/g, "/") });
        }
    }
    return out;
}

/** The dsh surfaces a consumer's `apply` and the adapter own. */
const SURFACES = /ctx\.configForms|configForms\.get|settings\.describe|settings\.configure|\.configure\(|entry\.update|slots\.(inject|register)|describe\(\)/g;

/** Paths allowed to hold dsh surfaces (the adapter and the card machinery). */
function allowed(relative) {
    return relative.startsWith("src/host/adapter/") ||
        relative.startsWith("src/client/apply") ||
        relative.startsWith("src/client/controller/");
}

test("no block, style or locale module touches a dsh surface", async () => {
    const offenders = [];
    for (const [dir, name] of [[resolve(ROOT, "src/client/blocks"), "blocks"], [resolve(ROOT, "src/client/styles"), "styles"], [resolve(ROOT, "src/client/locales"), "locales"]]) {
        for (const source of await sources(dir)) {
            const text = await readFile(source.file, "utf8");
            const hits = [...String(text).matchAll(SURFACES)];
            for (const hit of hits) offenders.push(`${source.relative}: ${hit[0]}`);
        }
    }
    assert.deepEqual(offenders, [], "widget halves must receive data + callbacks, not services");
});

test("the only dsh surfaces in the whole source tree live under adapter/apply/controller", async () => {
    const offenders = [];
    for (const source of await sources(resolve(ROOT, "src"))) {
        if (allowed(source.relative)) continue;
        const text = await readFile(source.file, "utf8");
        const hits = [...String(text).matchAll(SURFACES)];
        for (const hit of hits) offenders.push(`${source.relative}: ${hit[0]}`);
    }
    assert.deepEqual(offenders, [], "only the adapter layer may import a dsh surface");
});

/**
 * A consumer's descriptor is the whole surface: a capability that can only be
 * reached by importing a service is a missing hole, not a feature. This is the
 * shape the descriptor test of Fase 2 extends.
 */
test("blocks never reference a form controller or plugin context", async () => {
    const banned = /Controller|browserContext|BrowserPluginContext|\bctx\b/;
    for (const source of await sources(resolve(ROOT, "src/client/blocks"))) {
        const text = await readFile(source.file, "utf8");
        const hits = [...text.matchAll(new RegExp(banned, "g"))];
        assert.equal(hits.length, 0, `${source.relative} references ${hits.map((hit) => hit[0]).join(", ") || "nothing"}`);
    }
});
