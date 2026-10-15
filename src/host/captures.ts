/**
 * The two capture paths that reach the live mirror.
 *
 * A running host says *only* two things about how it is doing: its own log
 * lines (dsh-mcp-client reports connection trouble through its logger, nothing
 * else) and settled tool results (a browser-level failure surfaces only on the
 * tool surface). So this module gives the consumer two capture holes, each
 * writing the live mirror, and nothing of the *classification* — which line is
 * the known, developer-actionable one stays in `host/status`.
 *
 * What the logger capture must never touch is the known answer already standing
 * (see `host/status`: only evidence clears it). That is the consumer's call in
 * the sink — the capture only hands lines over, warn-level or otherwise.
 */
import { toolResultNote } from "./status.js";

import { log, type AdapterContext } from "./adapter/dsh.js";

/** One level call: `level` plus the joined arguments. */
export interface LogLine {
    level: string;
    message: string;
}

/** Join logger arguments, errors spelled with their stack when they have one. */
export function formatLogArgs(args: readonly unknown[]): string {
    return args.map((arg) => (arg instanceof Error ? (arg.stack ?? arg.message ?? String(arg)) : String(arg))).join(" ");
}

/**
 * Wrap one logger so the sink answers **before** the original level call (the
 * wrapper shares the underlying logger and only shadows level methods, so
 * exporters keep working). This is the child the nested bridge fiber gets.
 *
 * Returns the wrapper; disposing nothing is correct here — the wrapper simply
 * leaves with the scope that carried it.
 */
export function captureBridgeLog(base: Record<string, (...args: unknown[]) => unknown>, sink: (line: LogLine) => void): Record<string, (...args: unknown[]) => unknown> {
    const levels = ["error", "warn", "info", "debug", "trace", "fatal"];
    const wrapper: Record<string, (...args: unknown[]) => unknown> = ((...args: unknown[]) => {
        const callBase = base as unknown as (...args: unknown[]) => unknown;
        return callBase(...args);
    }) as unknown as Record<string, (...args: unknown[]) => unknown>;
    Object.setPrototypeOf(wrapper, Object.getPrototypeOf(base));
    Object.assign(wrapper, base);
    for (const level of levels) {
        wrapper[level] = (...args: unknown[]) => {
            sink({ level, message: formatLogArgs(args) });
            return (base[level] as (...args: unknown[]) => unknown)?.(...args);
        };
    }
    return wrapper;
}

/** One settled tool call: the registered name and what it answered. */
export interface ToolResultEvent {
    name: string;
    result: unknown;
}

/** What matches a settled call: one registered-name prefix (the plugin's own
 * name, `mcp__<serverName>__`, never something the shared half guesses), a set
 * of prefixes — one row that stands behind N namespaces answers for all of them
 * (hueco ND1) — or a predicate over the registered name. */
export type ToolCaptureMatch = string | ReadonlySet<string> | ((name: string) => boolean);

/** Whether one registered name answers to one match. A set matches the names it
 * carries; a string matches the prefix; a predicate decides, and a predicate
 * that throws matches nothing — a capture must never change what runs. */
export function matchesToolName(name: string, match: ToolCaptureMatch): boolean {
    if (typeof match === "string") return name.startsWith(match);
    if (typeof match === "function") {
        try {
            return match(name) === true;
        } catch {
            return false;
        }
    }
    if (match !== null && typeof match === "object" && typeof (match as ReadonlySet<string>).has === "function") {
        for (const prefix of match as Iterable<string>) {
            if (typeof prefix === "string" && name.startsWith(prefix)) return true;
        }
        return false;
    }
    return false;
}

/** What `captureToolResults` needs. */
export interface ToolCaptureOptions {
    /** Registered-name match — one prefix, a set of prefixes, or a predicate.
     * The plugin's own names, never something the shared half guesses. */
    prefix: ToolCaptureMatch;
    /** Answered for every settled call this host owns; `note` is already
     * composed through `host/status.toolResultNote`. */
    onResult(note: string | null, name: string): void;
    /** Log prefix. */
    name?: string;
}

/**
 * Register the tool-call status capture: a settled call whose registered name
 * carries this host's prefix and answers a failure surfaces on the live
 * mirror; a success answers `null` so the consumer can clear what stands.
 *
 * The body is wrapped so a capture fault can never break a tool call, and the
 * original result is passed through untouched. Returns a disposer for the
 * listener.
 */
export function captureToolResults(ctx: AdapterContext, options: ToolCaptureOptions): () => void {
    const handler = async (exec: unknown, result: unknown, next: () => unknown): Promise<unknown> => {
        try {
            const name = (exec as { name?: unknown } | undefined)?.name;
            if (typeof name === "string" && matchesToolName(name, options.prefix)) {
                options.onResult(toolResultNote(name, result as { isError?: boolean } | null | undefined), name);
            }
        } catch (error) {
            log(ctx, "warn", options.name, `tool status capture failed: ${String(error)}`);
        }
        return next();
    };
    const dispose = ctx.on?.("tools/post-execute", handler);
    return typeof dispose === "function" ? dispose : () => void 0;
}
