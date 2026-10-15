/**
 * Locale merging — plugin keys win, shared keys stay shared, no plugin domain
 * leaks into the shared half.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { DICTIONARIES, LOCALE_NAMESPACE, mergeDictionaries } from "../lib/locales.js";

test("the shared namespace is a fixed identifier", () => {
    assert.equal(LOCALE_NAMESPACE, "dshAncesters");
});

test("the shared half carries only cross-card keys", () => {
    const keys = Object.keys(DICTIONARIES.en);
    for (const shared of ["apply", "discard", "saving", "unsaved", "saveFailed", "cancel", "close", "search", "searchNoResults", "searchPlaceholder", "addSelected", "toastStall", "toastError"]) {
        assert.equal(keys.includes(shared), true, `missing shared key "${shared}"`);
    }
});

test("every shared dictionary sits under an id the shell's locale service declares", () => {
    // dsh's `client/locale` declares `LOCALE_IDS = ['zh', 'en']`: any other id
    // (`en-US`) is never read, and its keys come back as the keys themselves.
    for (const id of Object.keys(DICTIONARIES)) assert.equal(["zh", "en"].includes(id), true, `"${id}" is not a declared locale id`);
});

test("the merge keeps every locale it was shown", () => {
    const merged = mergeDictionaries({ "en-US": { a: "A" }, "es-ES": { a: "LA" } }, { "fr-FR": { a: "PA" } });
    assert.deepEqual(Object.keys(merged).sort(), ["en-US", "es-ES", "fr-FR"]);
    assert.equal(merged["fr-FR"].a, "PA");
});

test("the plugin key wins on collision, everything else stays shared", () => {
    const merged = mergeDictionaries(DICTIONARIES, {
        en: { cancel: "Stop the run", mineKey: "mine" }
    });
    assert.equal(merged.en.cancel, "Stop the run");
    assert.equal(merged.en.mineKey, "mine");
    assert.equal(merged.en.apply, DICTIONARIES.en.apply);
});

test("merging is one level per locale and never touches the base", () => {
    const base = { "en-US": { a: "A", b: "B" } };
    const merged = mergeDictionaries(base, { "en-US": { b: "B2" } });
    assert.equal(base["en-US"].b, "B");
    assert.notEqual(merged["en-US"], base["en-US"]);
});
