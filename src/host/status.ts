/**
 * Error classification and status notes — the human-readable half.
 *
 * Every capture path (check failure, bridge log line, tool-call result) ends in
 * one capped line on the live mirror. `classifyError` decides whether the line
 * is a **known, developer-actionable** state (e.g. "no executable was
 * detected") — the default classifier is the one all three reference
 * checkouts agreed on — or a generic failure. A consumer replaces the
 * classification through `rules.classify` without touching the rest.
 *
 * The persistence rule is behavioral, not textual: a known error that has
 * already landed is only cleared by **evidence** — a version probe that answers
 * or a successful tool call — never by a reconnect line, a `fiber.update()`
 * that answered, or any other non-evidenced success. The card keeps that rule
 * (it owns the write); this module only classifies what arrived.
 */

/** Default cap of one status line (chrome + docker agree). */
export const ERROR_CAP = 200;

/**
 * The known "no executable detected" families, agreed by the three checkouts:
 * our own ENOENT/discovery lines, the upstream executable-discovery failures,
 * puppeteer's configured-path miss, and the umbrella launch failure. A tool
 * name or path inside the message never changes the answer.
 */
const EXECUTABLE_MISSING_PATTERNS = [
    /executable (?:not|could not be) found/iu,
    /could not find (?:google |the |a )?(?:executable|chrome|browser)(?: executable)?/iu,
    /(?:browser|executable) was not found at the configured/iu,
    /failed to launch (?:the )?(?:browser|process)/iu,
    /spawn(?:eacces|enoent)?\b/iu,
    /no such file or directory\b[\s\S]*executable/iu
];

/** How a consumer adjusts the default classification. */
export interface ErrorRules {
    /** More families the consumer considers known-and-actionable. */
    knownErrors?: readonly RegExp[];
    /** Replace the whole classification (return the note label or null when
     * the line is *not* a known error). */
    classify?: (message: string) => string | null | undefined;
}

/** First non-empty line of a text block, capped. */
export function firstLine(text: unknown, cap: number = ERROR_CAP): string {
    const line = String(text ?? "")
        .split(/\r?\n/u)
        .find((candidate) => candidate.trim() !== "") ?? "";
    return line.trim().slice(0, cap);
}

/**
 * Whether one error line is the known, developer-actionable
 * "no executable detected" state (the shared default). Pass `rules.knownErrors`
 * to add families, or `rules.classify` to own the answer wholesale.
 */
/**
 * Whether one error line is the known, developer-actionable
 * "no executable detected" state (the shared default). Pass `rules.knownErrors`
 * to add families; pass `rules.classify` to own the answer wholesale — when a
 * classifier is given it is *the* answer: a known-error label answers true,
 * nothing answers false, and the defaults never run behind it.
 */
export function isExecutableMissing(text: unknown, rules: ErrorRules = {}): boolean {
    const message = String(text ?? "");
    if (rules.classify !== void 0) {
        return Boolean(rules.classify(message));
    }
    for (const pattern of rules.knownErrors === void 0 ? EXECUTABLE_MISSING_PATTERNS : [...EXECUTABLE_MISSING_PATTERNS, ...rules.knownErrors]) {
        if (pattern.test(message)) return true;
    }
    return false;
}

/** What a tool-result note is composed from. */
export interface ToolResultLike {
    isError?: boolean;
    content?: unknown;
    error?: { message?: unknown } | unknown;
}

/**
 * Summarize one tool call result for a card's status line. Failed calls return
 * `"<tool> failed: <first text line>"`; successes return null so the caller
 * clears the stored error (clearing is evidence: see this module's header).
 * @param toolName - fully qualified registered name (`<prefix>__<tool>`); the
 *        prefix may be any namespace the plugin registered under.
 */
export function toolResultNote(toolName: string, result: ToolResultLike | null | undefined): string | null {
    if (!result || result.isError !== true) return null;
    const blocks = Array.isArray(result.content) ? (result.content as { type?: unknown; text?: unknown }[]) : [];
    let text = blocks
        .filter((block) => block && block.type === "text" && typeof block.text === "string")
        .map((block) => String(block.text))
        .join(" ");
    const error = result.error;
    if (text === "" && error !== null && error !== void 0 && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
        text = String((error as { message: string }).message);
    }
    if (text === "") text = error === void 0 ? "unknown error" : String(error);
    const tool = typeof toolName === "string" ? toolName.split("__").pop() : toolName;
    return firstLine(`${tool} failed: ${text}`);
}
