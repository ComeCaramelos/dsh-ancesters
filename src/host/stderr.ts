/**
 * Routing a bridge's stderr.
 *
 * A bridge's stdio transport inherits stderr, so every startup/progress line
 * lands on the dsh console. The default `"log"` mode launches the bridge
 * through `./stderr-wrapper.js` under the running Node (`process.execPath`):
 * the wrapper spawns the argv verbatim with stdin/stdout inherited — the MCP
 * protocol stream is never touched — and **only stderr** pointed at a private
 * per-process log file.
 *
 * One route on every platform. The wrapper used to be a `sh -c` script, which
 * left Windows (no POSIX shell) printing on the console; Node is always there,
 * because it is what runs the host. Nothing here knows any server name other
 * than the one it was handed.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** Where `mkdtemp` builds the private directory. */
const LOG_DIR_PREFIX = "dsh-ancesters-bridge-";

/** The wrapper script, emitted next to this module by `tsc`. */
export const STDERR_WRAPPER_PATH = fileURLToPath(new URL("./stderr-wrapper.js", import.meta.url));

/** A created private directory, reused for the process lifetime. */
let logDir = "";

/**
 * The private per-process directory that holds bridge stderr logs, created
 * exclusively (`mkdtemp`) and mode `0700`. Nothing inside is predictable, and
 * every redirect stays inside it. Falls back to the flat tmp name when even
 * `mkdtemp` fails (an unwritable tmp, a sandbox that denies the write): a
 * logless bridge is still better than a failed spawn.
 * @param serverName - names the log file inside the directory.
 * @param options - `tmpdir`/`pid` overrides for tests and diagnostics (the
 *        override keeps the flat `<name>-bridge-<pid>.log` naming so a
 *        deterministic path stays easy to assert).
 */
export function stderrLogPath(serverName: unknown, options: { tmpdir?: string; pid?: number } = {}): string {
    const safe = typeof serverName === "string" && serverName !== "" ? serverName.replace(/[^A-Za-z0-9_-]/gu, "-") : "bridge";
    if (typeof options.tmpdir === "string" && options.tmpdir !== "") {
        const pid = options.pid === void 0 ? process.pid : options.pid;
        return path.join(options.tmpdir, `${LOG_DIR_PREFIX}${safe}-bridge-${pid}.log`);
    }
    if (logDir === "" || !fs.existsSync(logDir)) {
        try {
            logDir = fs.mkdtempSync(path.join(os.tmpdir(), LOG_DIR_PREFIX));
        } catch {
            const pid = options.pid === void 0 ? process.pid : options.pid;
            return path.join(os.tmpdir(), `${LOG_DIR_PREFIX}${safe}-bridge-${pid}.log`);
        }
        try {
            fs.chmodSync(logDir, 0o700);
        } catch {
            // mkdtemp already applied 0700; a chmod failure cannot widen access.
        }
    }
    return path.join(logDir, `${safe}-bridge.log`);
}

/** The effective stderr mode: "log" redirects, anything else inherits. */
export type StderrMode = "log" | string;

/** One spawn target: what to run, how to treat stderr, optional log path. */
export interface SpawnTarget {
    command: string;
    args: readonly string[];
    /** Defaults to "log". */
    stderr?: StderrMode;
    /** Explicit log path; defaults to {@link stderrLogPath}. */
    logPath?: string;
    /** Names the log file when `logPath` is absent. */
    serverName?: string;
}

/** The resolved spawn shape a bridge transport consumes. */
export interface SpawnResult {
    command: string;
    args: string[];
    /** The stderr log file when redirected ("" otherwise). */
    redirect: string;
}

/** Overrides, so a consumer's tests never depend on the host. */
export interface StderrOptions {
    /** The Node that runs the wrapper; defaults to `process.execPath`. */
    execPath?: string;
    tmpdir?: string;
    pid?: number;
}

/**
 * Resolve one bridge spawn under its effective stderr mode.
 *
 * The caller keeps composing its own argv (`<command> <args…>`, plus whatever
 * config pass-throughs the transport needs); this only decides *how* it is
 * launched and where its stderr lands. In `"log"` mode the answer is
 * `<node> <wrapper> <logPath> <serverName> <command> <args…>` on every
 * platform; any other mode spawns the argv as given.
 * @param target - what to run.
 * @param options - Node / log-dir overrides.
 */
export function buildSpawn(target: SpawnTarget, options: StderrOptions = {}): SpawnResult {
    const raw: SpawnResult = { command: target.command, args: [...target.args], redirect: "" };
    const mode: StderrMode = target.stderr === void 0 ? "log" : target.stderr;
    if (mode !== "log") return raw;

    const serverName = typeof target.serverName === "string" && target.serverName !== "" ? target.serverName : "bridge";
    const logPath =
        typeof target.logPath === "string" && target.logPath !== "" ? target.logPath : stderrLogPath(serverName, options);
    return {
        command: options.execPath ?? process.execPath,
        args: [STDERR_WRAPPER_PATH, logPath, serverName, target.command, ...target.args],
        redirect: logPath
    };
}
