/**
 * stderr routing: the Node wrapper's spawn shape, what the wrapper really does
 * with a child (stdout untouched, stderr to the log, exit code, 127, signals),
 * and the private log dir.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { STDERR_WRAPPER_PATH, buildSpawn, stderrLogPath } from "../lib/host/stderr.js";

test("log mode runs the wrapper under Node and leaves the argv verbatim", () => {
    const result = buildSpawn(
        { command: "npx", args: ["-y", "server@1", "--flag=a b"], serverName: "srv", stderr: "log" },
        { execPath: "/opt/node", tmpdir: "/tmp/t", pid: 9 }
    );
    const log = stderrLogPath("srv", { tmpdir: "/tmp/t", pid: 9 });
    assert.equal(result.command, "/opt/node");
    assert.deepEqual(result.args, [STDERR_WRAPPER_PATH, log, "srv", "npx", "-y", "server@1", "--flag=a b"]);
    assert.equal(result.redirect, log);
    assert.equal(existsSync(STDERR_WRAPPER_PATH), true, "the wrapper ships next to the module");
});

test("the same shape on every platform: there is no shell to miss", () => {
    const result = buildSpawn({ command: "x", args: [] });
    assert.equal(result.command, process.execPath);
    assert.equal(result.args[0], STDERR_WRAPPER_PATH);
    assert.equal("fallback" in result, false, "no platform/shell fallback is left to report");
});

test("an explicit log path is honored", () => {
    const result = buildSpawn({ command: "x", args: [], logPath: "/tmp/custom.log" });
    assert.equal(result.redirect, "/tmp/custom.log");
    assert.equal(result.args[1], "/tmp/custom.log");
});

test("console mode inherits: no wrapper, no redirect", () => {
    const plain = buildSpawn({ command: "x", args: ["-y"], stderr: "console" });
    assert.deepEqual(plain, { command: "x", args: ["-y"], redirect: "" });
});

test("the log path stays inside a private directory created 0700", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "dsh-ancesters-test-"));
    // The flat naming is only for tests/diagnostics; the default path must
    // live under a directory the process created itself.
    const flat = stderrLogPath("srv", { tmpdir: base, pid: 1 });
    assert.equal(flat.startsWith(base + path.sep), true);

    const first = stderrLogPath("srv");
    const second = stderrLogPath("srv");
    assert.equal(first, second, "one directory per host process, reused across spawns");
    assert.equal(path.basename(first), "srv-bridge.log");
    assert.notEqual(first.startsWith(base + path.sep), true);
});

/** A fake bridge: a Node script, so the same test runs on every platform. */
async function fakeBridge(body) {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dsh-ancesters-wrapper-"));
    const script = path.join(dir, "bridge.mjs");
    await writeFile(script, body);
    return { dir, script, log: path.join(dir, "bridge.log") };
}

test("the wrapper keeps stdout as the protocol stream and sends only stderr to the log", async () => {
    const bridge = await fakeBridge(
        'process.stdin.setEncoding("utf8");' +
            'let input = "";' +
            'process.stdin.on("data", (chunk) => { input += chunk; });' +
            'process.stdin.on("end", () => { process.stdout.write("OUT:" + input + ":" + process.argv.slice(2).join("|")); process.stderr.write("ERR-LINE"); process.exit(3); });'
    );
    const spawned = buildSpawn({ command: process.execPath, args: [bridge.script, "a b", "--x=1"], serverName: "srv", logPath: bridge.log });
    const run = spawnSync(spawned.command, spawned.args, { input: "ping", encoding: "utf8" });
    assert.equal(run.stdout, "OUT:ping:a b|--x=1", "stdin and stdout reach the child untouched, argv verbatim");
    assert.equal(run.stderr, "", "nothing of the child's stderr reaches the console");
    assert.equal(await readFile(bridge.log, "utf8"), "ERR-LINE");
    assert.equal(run.status, 3, "the child's exit code is the wrapper's");
});

test("a missing executable exits 127 and says so on the console", async () => {
    const bridge = await fakeBridge("");
    const missing = path.join(bridge.dir, "no-such-bridge");
    const spawned = buildSpawn({ command: missing, args: [], serverName: "srv", logPath: bridge.log });
    const run = spawnSync(spawned.command, spawned.args, { encoding: "utf8" });
    assert.equal(run.status, 127);
    assert.match(run.stderr, /^srv: bridge executable not found: /);
});

test("a log that cannot open degrades to the console and still runs the bridge", async () => {
    const bridge = await fakeBridge('process.stdout.write("OUT"); process.stderr.write("ERR");');
    const unwritable = path.join(bridge.dir, "missing-dir", "bridge.log");
    const spawned = buildSpawn({ command: process.execPath, args: [bridge.script], serverName: "srv", logPath: unwritable });
    const run = spawnSync(spawned.command, spawned.args, { encoding: "utf8" });
    assert.equal(run.stdout, "OUT");
    assert.match(run.stderr, /srv: cannot open the stderr log/);
    assert.match(run.stderr, /ERR$/);
    assert.equal(run.status, 0);
});

test("SIGTERM to the wrapper reaches the bridge", { skip: process.platform === "win32" && "no signals on Windows" }, async () => {
    const bridge = await fakeBridge(
        'process.on("SIGTERM", () => { process.stderr.write("GOT-TERM"); process.exit(0); });' +
            'process.stdout.write(String(process.pid) + "\\n");' +
            "setInterval(() => {}, 1000);"
    );
    const spawned = buildSpawn({ command: process.execPath, args: [bridge.script], serverName: "srv", logPath: bridge.log });
    const wrapper = spawn(spawned.command, spawned.args, { stdio: ["pipe", "pipe", "pipe"] });
    const childPid = await new Promise((resolve) => wrapper.stdout.once("data", (chunk) => resolve(Number(String(chunk).trim()))));
    const exited = new Promise((resolve) => wrapper.once("exit", (code, signal) => resolve({ code, signal })));
    wrapper.kill("SIGTERM");
    assert.deepEqual(await exited, { code: 0, signal: null }, "the bridge handled the signal and the wrapper followed it out");
    assert.equal(await readFile(bridge.log, "utf8"), "GOT-TERM");
    assert.throws(() => process.kill(childPid, 0), "the bridge is gone, not orphaned");
});
