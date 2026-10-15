/**
 * Styles injection — exactly one `<style>` per sheet, whatever a page carries.
 *
 * Two cards from two different plugins mount into one page; if each injected
 * its own sheet copy the page would render the rules twice (and drift the
 * second time). The key is the sheet, not the consumer: same content hash,
 * same `<style>`.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { injectCardStyles, SHEET_ID } from "../lib/styles.js";

/** A fake head that records every injected `<style>`. */
function fakeDocument() {
    const styleTags = [];
    const head = {
        children: [],
        appendChild(tag) {
            this.children.push(tag);
            styleTags.push(tag);
        }
    };
    return {
        head,
        styleTags,
        createElement(name) {
            if (name !== "style") throw new Error("unexpected element " + name);
            return {
                dataset: {},
                textContent: "",
                matches(key) {
                    return this.dataset.dshAncestersCss === key.split('"')[1];
                }
            };
        },
        querySelectorAll(selector) {
            const wanted = selector.split('"')[1];
            return head.children.filter((tag) => tag.dataset.dshAncestersCss === wanted);
        }
    };
}

test("the sheet id is content-derived and stable", () => {
    assert.match(SHEET_ID, /^dsh-ancesters-[a-z0-9]{6}-[a-z0-9]+$/);
});

test("without a DOM, injection does nothing rather than crash", () => {
    assert.equal(typeof globalThis.document, "undefined");
    injectCardStyles();
});

test("one page, one sheet — the second call injects nothing", () => {
    const document = fakeDocument();
    globalThis.document = document;
    try {
        injectCardStyles();
        injectCardStyles();
        injectCardStyles();
        assert.equal(document.styleTags.length, 1, "two cards must not stack a second sheet");
        const tag = document.styleTags[0];
        assert.equal(tag.dataset.dshAncestersCss, SHEET_ID);
        assert.ok(tag.textContent.length > 1000, "the minified sheet must be carried");
        assert.match(tag.textContent, /[a-z0-9]{6}_[A-Za-z]/, "class names must be scoped to the sheet");
    } finally {
        delete globalThis.document;
    }
});

test("sheets are keyed by content, so a card carrying its own sheet is idempotent too", () => {
    const document = fakeDocument();
    globalThis.document = document;
    try {
        const own = ".thing { color: red }";
        injectCardStyles([own]);
        injectCardStyles([own]);
        assert.equal(document.styleTags.length, 2, "the card's sheet lands beside the shared one, once each");

        const ids = document.styleTags.map((tag) => tag.dataset.dshAncestersCss);
        assert.notEqual(ids[0], ids[1], "two different sheets must not answer one id");
        assert.match(ids[1], /^dsh-ancesters-[a-z0-9]{6}-[a-z0-9]+$/);
    } finally {
        delete globalThis.document;
    }
});

test("the same content twice in one call stands one `<style>`", () => {
    const document = fakeDocument();
    globalThis.document = document;
    try {
        const own = ".thing { color: red }";
        injectCardStyles([own, own, own]);
        assert.equal(document.styleTags.length, 2, "shared sheet + the one distinct sheet");
    } finally {
        delete globalThis.document;
    }
});
