/**
 * Flags rules — the shared half, plus one consumer's hook.
 *
 * The shared rule set carries only what the reference checkouts all agreed on
 * (control characters only; connect-mode flags skip the probe); everything
 * one plugin refuses for domain reasons arrives through `reject`.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
    CONTROL_PATTERN,
    carriesConnectionMode,
    flagsSkipCheck,
    sameFlags,
    validateExtraFlags
} from "../lib/host/flags.js";

test("flags are execve'd argv entries: only control characters are refused", () => {
    assert.equal(validateExtraFlags(["--foo", "--foo=bar", "--foo bar", "-x"]), true);
    assert.equal(validateExtraFlags([]), true);
    assert.equal(validateExtraFlags(["--emoji \u{1f600}"]) === true, true);
});

test("empty entries and non-strings are refused with the entry quoted", () => {
    assert.throws(() => validateExtraFlags([""]), /non-empty strings/);
    assert.throws(() => validateExtraFlags([7]), /non-empty strings/);
    assert.throws(() => validateExtraFlags("--x"), /must be an array/);
});

test("control characters are refused and named back", () => {
    assert.equal(CONTROL_PATTERN.test("plain text with spaces"), false);
    for (const bad of ["--x\ny", "--x\ty\tz", "--x\u0000", "--x\u007f"]) {
        assert.throws(() => validateExtraFlags([bad]), /control characters/);
    }
});

test("the consumer's domain can refuse more — and only more", () => {
    const hook = {
        reject: (flag) => (/^--executable(?:Path|-path)?(?:=|(?=\s)|$)/iu.test(flag)
            ? "selects the executable — pick it in the picker instead"
            : null)
    };
    assert.equal(validateExtraFlags(["--foo"], hook), true);
    assert.throws(() => validateExtraFlags(["--executablePath=/x"], hook), /picker instead/);
    // Without the hook, the same flag passes: the refusal is the consumer's,
    // never a shared `if` for one domain.
    assert.equal(validateExtraFlags(["-e", "/x"], {}), true);
});

test("connect-mode flags spare the executable probe", () => {
    assert.equal(carriesConnectionMode("--browserUrl=http://x"), true);
    assert.equal(carriesConnectionMode("--wsEndpoint=ws://x"), true);
    assert.equal(carriesConnectionMode("--browserUrl http://x"), true);
    assert.equal(carriesConnectionMode("--wsEndpoint ws://x"), true);
    assert.equal(carriesConnectionMode("--browser-url"), false);
    assert.equal(flagsSkipCheck(["--foo", "--wsEndpoint=ws://x"]), true);
    assert.equal(flagsSkipCheck(["--foo"]), false);
    assert.equal(flagsSkipCheck("nonsense"), false);
});

test("sameFlags compares lists element-wise", () => {
    assert.equal(sameFlags(["a", "b"], ["a", "b"]), true);
    assert.equal(sameFlags(["a", "b"], ["b", "a"]), false);
    assert.equal(sameFlags(["a"], ["a", "a"]), false);
    assert.equal(sameFlags(["a"], "a"), false);
});
