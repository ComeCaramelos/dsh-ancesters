/**
 * Host platform probes: is this Linux host a Windows Subsystem for Linux
 * instance, and does one executable path name a Windows binary rather than a
 * Linux one.
 *
 * Both probes stay pure and injectable (`platform`, `env`, `exists`) so tests
 * never depend on the machine they run on — and so consumers (chrome's interop
 * warning) can combine them without this module knowing what a card does with
 * the answer.
 */
import { existsSync } from "node:fs";

/** Linux-side markers that only a WSL instance carries. */
const WSL_ENV_VARS = ["WSL_DISTRO_NAME", "WSL_DISTRO_LABEL", "WSL_INTEROP"] as const;

/** The binfmt marker a WSL instance mounts and a plain Linux host does not. */
const WSL_INTEROP_MARKER = "/proc/sys/fs/binfmt_misc/WSLInterop";

/** A path is Windows-side when it lives on the interop mount, carries the
 * Windows spelling (UNC or `C:\`), or simply names a PE. */
const WINDOWS_PATH_PATTERN = /^(?:\/mnt\/[a-z]\/|\\\\[\w.-]+\\|[a-z]:[\\/])/iu;
const WINDOWS_EXE_PATTERN = /\.exe$/iu;

/** Everything {@link isWindowsSubsystemForLinux} consults; each field defaults
 * to what the running process actually is. */
export type PlatformProbe = {
    /** Defaults to `process.platform`. */
    platform?: NodeJS.Platform;
    /** Variable lookup; defaults to the absence lookup below. Supplying an
     * env source makes the marker file irrelevant — a deterministic answer
     * instead of one that depends on what the host booted into. */
    env?: (name: string) => unknown;
    /** File-presence lookup used only when `env` is not supplied. */
    exists?: (path: string) => boolean;
};

/**
 * True when the current process runs inside Windows Subsystem for Linux: a
 * Linux kernel plus the WSL markers. A non-Linux platform (a plain Windows
 * host) is never "under WSL", whatever its environment says.
 */
export function isWindowsSubsystemForLinux(probe: PlatformProbe = {}): boolean {
    const platform = probe.platform ?? process.platform;
    if (platform !== "linux") return false;
    if (probe.env !== void 0) {
        return WSL_ENV_VARS.some((name) => {
            const value = probe.env!(name);
            return typeof value === "string" && value.trim() !== "";
        });
    }
    return (probe.exists ?? ((candidate: string) => existsSync(candidate)))(WSL_INTEROP_MARKER);
}

/**
 * True when `path` names a Windows binary (interop mount, Windows spelling,
 * or a `.exe`). A Linux path is never Windows-side.
 */
export function isWindowsExecutablePath(path: unknown): boolean {
    if (typeof path !== "string") return false;
    const candidate = path.trim();
    if (candidate === "") return false;
    return WINDOWS_PATH_PATTERN.test(candidate) || WINDOWS_EXE_PATTERN.test(candidate);
}

/**
 * True when we are under WSL **and** what is selected is a Windows executable
 * — the one combination the two probes combine into. Neither alone answers
 * anything.
 */
export function isWindowsExecutableUnderWsl(path: unknown, probe: PlatformProbe = {}): boolean {
    return isWindowsSubsystemForLinux(probe) && isWindowsExecutablePath(path);
}
