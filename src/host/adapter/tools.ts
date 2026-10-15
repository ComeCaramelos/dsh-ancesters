/**
 * Tool registry view — what the running host actually registered (H4).
 *
 * Every MCP tool registers under `mcp__<namespace>__<name>`, so "which tools
 * does this server really serve?" is answered by filtering the registry view
 * the shell publishes, without ever talking to the server. That is a surface of
 * the shell, so it lives in the adapter layer (`test/surface.test.mjs`); a
 * consumer that reads `ctx.get("tools")` itself is a consumer that repeats the
 * surface and finds out where it broke.
 *
 * A registry that will not answer is not a failure of the connection: the answer
 * is no tools, not a throw. But *no tools* and *a surface that moved* are two
 * different answers — the first is what a silent server says, the second means
 * every line on the card quietly says "none" forever. So the shape is asked
 * for once, named once, loudly (`contratos-dsh.md` §9: shout first, never
 * substitute a default for a surface the host no longer answers).
 */
/** One shout per surface: a registry read every other second must not answer
 * the same line again, and a registry that came back once has already been
 * named. Keyed by the surface itself (or the context, when there is none). */
const shouted = new WeakSet<object>();

/** Shout about a registry surface that does not answer — once. */
function shoutSurface(ctx: AdapterContext, tools: unknown, shape: string): void {
    const key = (tools === null || typeof tools !== "object" ? ctx : tools) as object;
    if (shouted.has(key)) return;
    shouted.add(key);
    (ctx.logger?.warn ?? ((line: string) => void line))(
        `tools: the registry surface did not answer (${shape}); every namespace reads as no tools`
    );
}
import type { AdapterContext } from "./dsh.js";

/** One registered tool as the registry shows it. */
interface ToolSchema {
    name?: unknown;
}

/** Whether one registered tool name lives under `mcp__<namespace>__`. */
export function toolNamespaceOf(name: unknown, namespace: string): boolean {
    return typeof name === "string" && name.startsWith(`mcp__${namespace}__`);
}

/**
 * The tool names registered under one namespace, sorted.
 * @param ctx - the plugin context the registry is read through.
 * @param namespace - the server namespace, without the `mcp__…__` wrapper.
 */
export function toolNamesByNamespace(ctx: AdapterContext, namespace: string): string[] {
    const tools = typeof ctx.get === "function" ? ctx.get("tools") : void 0;
    const schemas = (tools as { schemas?: (scope?: unknown) => readonly ToolSchema[] } | undefined)?.schemas;
    if (typeof schemas !== "function") {
        shoutSurface(ctx, tools, tools === undefined ? "no tools registry on the context" : "no schemas() on it");
        return [];
    }
    try {
        return (schemas.call(tools) as readonly ToolSchema[])
            .filter((schema) => toolNamespaceOf(schema?.name, namespace))
            .map((schema) => String((schema as { name: string }).name))
            .sort();
    } catch {
        // A registry that throws is still no tools for this line — but it is
        // said once, where a card's user will look.
        shoutSurface(ctx, tools, "schemas() threw");
        return [];
    }
}
