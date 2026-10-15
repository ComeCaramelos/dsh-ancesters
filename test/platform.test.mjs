/**
 * Platform probes: pure, injectable — no test depends on the machine it runs
 * on (a `process.env` lookup would make a checkout pass or fail by accident).
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
    isWindowsExecutablePath,
    isWindowsExecutableUnderWsl,
    isWindowsSubsystemForLinux
} from "../lib/host/platform.js";

test("isWindowsExecutablePath answers the path only", () => {
    for (const path of [
        "/mnt/c/Program Files/Chrome/chrome.exe",
        "\\\\machine/share/chrome.exe",
        "C:\\Program Files\\chrome.exe",
        "/opt/chrome/bin/chrome.exe",
        "  /mnt/d/x.exe  "
    ]) {
        assert.equal(isWindowsExecutablePath(path), true, path);
    }
    for (const path of [
        "/usr/bin/google-chrome",
        "/opt/google/chrome/chrome",
        "",
        "   ",
        "/opt/google/chrome/chrome\x00"
    ]) {
        assert.equal(isWindowsExecutablePath(path), false, path);
    }
    assert.equal(isWindowsExecutablePath(7), false);
});

test("isWindowsSubsystemForLinux consults what it is told to consult", () => {
    assert.equal(isWindowsSubsystemForLinux({ platform: "win32", env: () => "x" }), false);
    assert.equal(isWindowsSubsystemForLinux({ platform: "linux", env: (name) => (name === "WSL_INTEROP" ? "/mnt/wsl/..." : "") }), true);
    assert.equal(isWindowsSubsystemForLinux({ platform: "linux", env: () => "" }), false);
    assert.equal(isWindowsSubsystemForLinux({ platform: "linux", exists: () => true }), true);
    assert.equal(isWindowsSubsystemForLinux({ platform: "linux", exists: () => false }), false);
    // A bare call reads this process — and answers something either way,
    // never throws.
    assert.equal(typeof isWindowsSubsystemForLinux(), "boolean");
});

test("the interop trap needs both halves — neither alone answers anything", () => {
    const wsl = { platform: "linux", env: () => "distro" };
    assert.equal(isWindowsExecutableUnderWsl("/mnt/c/x.exe", wsl), true);
    assert.equal(isWindowsExecutableUnderWsl("/usr/bin/chrome", wsl), false);
    assert.equal(isWindowsExecutableUnderWsl("C:\\x.exe", { platform: "win32", env: () => "x" }), false);
});
