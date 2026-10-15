/**
 * Builds the browser half.
 *
 * Same loader contract as every dsh plugin (`window.__ModuleLoader__.load`
 * via esbuild `banner`/`footer`), but registered under the *ancestor* id
 * `@comecaramelos/dsh-ancesters/client`: consumers bundle this file inside
 * their own `lib/client.js`, and the contract holds only because the id is
 * unique to the ancestor, never to the consumer.
 */
import { build } from "esbuild";
import { copyFile, readFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);
const ROOT_FS = fileURLToPath(ROOT);
const pkg = JSON.parse(await readFile(new URL("package.json", ROOT), "utf8"));

/** Id this loader module registers under — the ancestor id. */
export const LOADER_ID = `${pkg.name}/client`;

/** Modules the shell seeds into its module table; keep external. */
const BASELINE_MODULES = [
    "react",
    "react/jsx-runtime",
    "react-dom/client",
    "@deepseek-ai/dsh-client-store",
    "@deepseek-ai/dsh-client-ui-primitives"
];

/**
 * CSS Modules — the shared sheet is compiled once per emitted bundle: the
 * minified CSS text plus the class map (`<hash>_<local>`), scoped by a prefix
 * derived from the *source path* so the class names never drift with the
 * absolute path of the checkout a build happened to run in (the same idiom the
 * reference checkouts' own build carries).
 */
const cssModules = {
    name: "dsh-css-modules",
    setup(api) {
        api.onResolve({ filter: /\.module\.css$/ }, (args) => ({
            path: resolve(args.resolveDir, args.path),
            namespace: "dsh-css"
        }));
        api.onLoad({ filter: /.*/, namespace: "dsh-css" }, async (args) => {
            const source = await readFile(args.path, "utf8");
            const result = await build({
                stdin: { contents: source, sourcefile: basename(args.path), loader: "css", resolveDir: dirname(args.path) },
                bundle: true,
                minify: true,
                platform: "neutral",
                logLevel: "silent",
                write: false
            });
            const minified = String(result.outputFiles[0].text);
            const prefix = scopedName(relative(ROOT_FS, args.path).replace(/\\/g, "/"));
            const locals = [];
            const scoped = minified.replace(/\.([a-zA-Z_][\w-]*)/g, (_match, local) => {
                if (!locals.includes(local)) locals.push(local);
                return "." + prefix + "_" + local;
            });
            const styles = {};
            for (const local of locals) styles[local] = prefix + "_" + local;
            return {
                contents: [
                    "export const cssText = " + JSON.stringify(scoped) + ";",
                    "export default " + JSON.stringify(styles) + ";"
                ].join("\n"),
                loader: "js"
            };
        });
    }
};

/** Stable 6-char scope of one stylesheet, from its repo-relative path. */
function scopedName(sourcePath) {
    let hash = 0x811c9dc5 >>> 0;
    for (let index = 0; index < sourcePath.length; index++) {
        hash ^= sourcePath.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(36).padStart(6, "0").slice(0, 6);
}

const shared = {
    bundle: true,
    platform: "neutral",
    target: "es2022",
    external: BASELINE_MODULES,
    logLevel: "warning",
    plugins: [cssModules],
    tsconfigRaw: { compilerOptions: { strict: true } },
    sourcesContent: true
};

await build({
    ...shared,
    entryPoints: ["src/client/index.ts"],
    outfile: "lib/client.js",
    format: "cjs",
    sourcemap: "linked",
    banner: {
        js: [
            "window.__ModuleLoader__.load({",
            `\tid: ${JSON.stringify(LOADER_ID)},`,
            "\tfactory: (require) => {",
            "\t\tvar module = { exports: {} };",
            "\t\tvar exports = module.exports;",
            '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });'
        ].join("\n")
    },
    footer: {
        js: ["\treturn module.exports;", "\t}", "});"].join("\n")
    }
});

/**
 * The same surface as plain ESM — `./client/source`. The loader module above is
 * a registration, not something a consumer can import from; a consumer bundles
 * the shared half **into** its own `lib/client.js`, and this is the file it
 * bundles. It is emitted (not the TypeScript source) so a published copy of the
 * package serves it exactly like a linked checkout does, CSS Modules already
 * compiled in.
 */
await build({
    ...shared,
    entryPoints: ["src/client/index.ts"],
    outfile: "lib/client.esm.js",
    format: "esm"
});

/**
 * Plain modules: `./client/blocks`, `./styles`, `./locales` never register with
 * the loader — they are source-level dependencies bundled into every consumer's
 * own loader module. They emit as plain ESM (no banner), same externals, so a
 * consumer bundling them keeps exactly one React.
 */
for (const entry of ["blocks", "styles", "locales"]) {
    await build({
        ...shared,
        entryPoints: [`src/client/${entry}/index.ts`],
        outfile: `lib/${entry}.js`,
        format: "esm"
    });
}

/** Hand-written surfaces for the emitted bundles (one per bundle member). */
for (const name of ["client", "blocks", "styles", "locales"]) {
    await copyFile(new URL(`../src/client/${name}.d.ts`, import.meta.url), new URL(`../lib/${name}.d.ts`, import.meta.url));
}
