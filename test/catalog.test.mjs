/**
 * Catalog rules — id/name split, normalization, merge-by-id.
 *
 * The host half owns the rules (`src/host/catalog.ts`), and `src/client/catalog.ts`
 * re-exports that same source rather than mirroring it by hand: these fixtures
 * therefore pin *one* rule set that both halves run. A fixture that drifts is a
 * rule change, and a rule change moves through semver.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
    entryIds,
    entryLabel,
    findEntry,
    isValidEntryId,
    mergeEntries,
    normalizeEntries
} from "../lib/host/catalog.js";

/** Shared fixtures: both halves run these (client re-exports the same source). */
const FIXTURES = {
    /** Rows the user wrote: order preserved, ids trimmed, empties dropped. */
    "trims ids, drops empties, keeps order": {
        value: [
            { id: "  /opt/one  ", name: "One" },
            { id: "   ", name: "Blank" },
            { id: "/opt/two", name: "  " },
            "not-an-object",
            null,
            { id: "/opt/three", name: "Three" }
        ],
        expected: [
            { id: "/opt/one", name: "One" },
            { id: "/opt/two", name: "" },
            { id: "/opt/three", name: "Three" }
        ]
    },
    /** A repeated id never duplicates a row; the first one wins. */
    "folds the first row per id": {
        value: [
            { id: "/same", name: "First" },
            { id: "/same", name: "Second" }
        ],
        expected: [{ id: "/same", name: "First" }]
    },
    /** Anything the host never had a row for: no throw, empty list. */
    "non-arrays normalize to empty": {
        value: "nonsense",
        expected: []
    },
    /** Control characters cannot go on the wire. */
    "rejects ids carrying control characters": {
        value: [
            { id: "/bad\npath", name: "Bad" },
            { id: "/good\t", name: "Good" }
        ],
        expected: [{ id: "/good", name: "Good" }]
    },
    /** A tab inside the value is not an issue; a NUL is. */
    "keeps spaces inside a value, refuses control chars": {
        value: [
            { id: "/path with space/x", name: "Spaced" },
            { id: "/nul\0path", name: "Nul" }
        ],
        expected: [{ id: "/path with space/x", name: "Spaced" }]
    }
};

for (const [name, fixture] of Object.entries(FIXTURES)) {
    test(`normalizeEntries — ${name}`, () => {
        assert.deepEqual(normalizeEntries(fixture.value), fixture.expected);
    });
}

test("normalizeEntries caps the list (the tail drops off)", () => {
    const value = Array.from({ length: 80 }, (_unused, index) => ({ id: `/opt/x${index}`, name: "" }));
    const rows = normalizeEntries(value);
    assert.equal(rows.length, 50);
    assert.equal(rows[49].id, "/opt/x49");
});

test("normalizeEntries caps one row's display name", () => {
    const rows = normalizeEntries([{ id: "/x", name: "n".repeat(400) }]);
    assert.equal(rows[0].name.length, 200);
});

test("entryLabel falls back to the id when no name was chosen", () => {
    assert.equal(entryLabel({ id: "/opt/one", name: "One" }), "One");
    assert.equal(entryLabel({ id: "/opt/one", name: "   " }), "/opt/one");
});

test("mergeEntries keeps stored rows and lands new ids last, nameless", () => {
    const stored = [{ id: "/kept", name: "Kept" }];
    const { entries, changed } = mergeEntries(stored, ["/kept", "/new", "/new", "/bad\nid"]);
    assert.deepEqual(entries, [{ id: "/kept", name: "Kept" }, { id: "/new", name: "" }]);
    assert.equal(changed, true);
});

test("mergeEntries reports unchanged so a caller can skip a no-op write", () => {
    const stored = [{ id: "/kept", name: "Kept" }];
    const { changed } = mergeEntries(stored, ["/kept"]);
    assert.equal(changed, false);
});

test("mergeEntries never grows past the cap", () => {
    const stored = Array.from({ length: 50 }, (_unused, index) => ({ id: `/opt/x${index}`, name: "" }));
    const ids = Array.from({ length: 50 }, (_unused, index) => `/opt/y${index}`);
    const { entries } = mergeEntries(stored, ids);
    assert.equal(entries.length, 50);
});

test("isValidEntryId answers the rule, nothing else", () => {
    assert.equal(isValidEntryId("/opt/one"), true);
    assert.equal(isValidEntryId("  /opt/one  "), true);
    assert.equal(isValidEntryId(""), false);
    assert.equal(isValidEntryId("   "), false);
    assert.equal(isValidEntryId("bad\tid\u0000", {}), false);
    assert.equal(isValidEntryId(7), false);
});

test("a consumer's domain can own the rule", () => {
    // The reference profiles rule: no separators beyond . _ -, 128 cap.
    const profileRule = (id) => /^[A-Za-z0-9._-]{1,128}$/.test(id);
    assert.equal(isValidEntryId("default", { idRule: profileRule }), true);
    assert.equal(isValidEntryId("/opt/x", { idRule: profileRule }), false);
});

test("entryIds / findEntry read rows", () => {
    const rows = normalizeEntries([{ id: "/a", name: "A" }, { id: "/b", name: "" }]);
    assert.deepEqual(entryIds(rows), ["/a", "/b"]);
    assert.equal(entryIds(void 0).length, 0);
    assert.equal(findEntry(rows, "/b").name, "");
    assert.equal(findEntry(rows, "/missing"), void 0);
});

test("a rule's `fields` ride the rows that survived, never the ones dropped", () => {
    const rows = normalizeEntries(
        [
            { id: "/one", name: "One", command: "node", enabled: true },
            { id: "/one", name: "Duplicate" },
            { id: "", name: "No id", command: "true" },
            { id: "/two", name: "Two" }
        ],
        { fields: (row) => ({ command: String(row.command ?? ""), enabled: row.enabled !== false }) }
    );
    assert.deepEqual(rows.map((row) => row.id), ["/one", "/two"]);
    assert.equal(rows[0].command, "node");
    assert.equal(rows[0].enabled, true);
    assert.equal(rows[1].command, "", "an absent field answers its default, not a stale one");
    assert.equal(rows[1].enabled, true);
});

test("`fields` runs after the cap, so the budget is spent before it is read", () => {
    const rows = normalizeEntries(
        [{ id: "/a", name: "" }, { id: "/b", name: "" }, { id: "/c", name: "" }],
        { cap: 2, fields: (row) => ({ index: row.id }) }
    );
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.index), ["/a", "/b"]);
});
