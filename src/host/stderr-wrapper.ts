/**
 * The bridge stderr wrapper — a process of its own, never imported.
 *
 * `buildSpawn` (`./stderr.ts`) launches this file with the running Node
 * (`process.execPath`) in front of a bridge whose stderr should go to a log
 * file instead of the dsh console:
 *
 *     node stderr-wrapper.js <logPath> <serverName> <command> [args…]
 *
 * It spawns `<command> [args…]` with stdin and stdout **inherited** — the
 * child reads and writes the MCP protocol on the very descriptors the
 * transport handed this process, so nothing here ever touches the protocol
 * stream — and stderr pointed at `<logPath>`. The argv reaches the child
 * verbatim: no shell, no re-quoting. `cross-spawn` resolves `.cmd`/`.bat`
 * shims on Windows the same way the MCP SDK's own transport does, so `npx`
 * or `docker` from PATH behave as they would unwrapped.
 *
 * What the old `sh -c` wrapper guaranteed still holds:
 *
 *   * a missing executable exits 127 with the reason on the inherited stderr
 *     (the console), not buried in the log;
 *   * the child's exit code is this process's exit code.
 *
 * What an intermediate process adds and this file answers: a termination
 * signal the transport sends (`close()` sends SIGTERM, then SIGKILL) is
 * forwarded to the child, and a child that dies by signal is re-raised here.
 * SIGKILL cannot be forwarded, and Windows has no signals at all — there the
 * child is left to the stdin EOF the transport's `close()` also delivers,
 * which is how an MCP server learns its client went away.
 *
 * A log file that cannot be opened degrades to an inherited stderr with one
 * line saying so: a bridge that logs to the console still runs.
 */
import { openSync } from "node:fs";

import spawn from "cross-spawn";

/** The exit status a shell gives an executable it cannot find. */
const NOT_FOUND = 127;

/** Signals the transport (or a terminal) may send that the child must see. */
const FORWARDED = ["SIGTERM", "SIGINT", "SIGHUP"] as const;

const [logPath, serverName, command, ...args] = process.argv.slice(2);
const name = (serverName ?? "bridge").replace(/[^A-Za-z0-9_-]/gu, "-") || "bridge";

if (logPath === void 0 || command === void 0 || command === "") {
    process.stderr.write(`${name}: stderr wrapper needs <logPath> <serverName> <command> [args…]\n`);
    process.exit(2);
}

/** stderr's destination: the log file, or the inherited stream when it cannot open. */
let stderr: number | "inherit";
try {
    // Truncated per spawn: one log per bridge run, like the shell redirect was.
    stderr = openSync(logPath, "w", 0o600);
} catch (error) {
    process.stderr.write(`${name}: cannot open the stderr log ${logPath} (${String(error)}) — stderr stays on the console\n`);
    stderr = "inherit";
}

const child = spawn(command, args, { stdio: ["inherit", "inherit", stderr], windowsHide: true });

for (const signal of FORWARDED) {
    process.on(signal, () => {
        child.kill(signal);
    });
}

child.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
        process.stderr.write(`${name}: bridge executable not found: ${command}\n`);
        process.exit(NOT_FOUND);
    }
    process.stderr.write(`${name}: bridge failed to start: ${error.message}\n`);
    process.exit(1);
});

child.on("exit", (code, signal) => {
    if (signal !== null && process.platform !== "win32") {
        // Die the way the child died, so the transport reads the same answer.
        for (const forwarded of FORWARDED) process.removeAllListeners(forwarded);
        process.kill(process.pid, signal);
        return;
    }
    process.exit(code ?? 1);
});
