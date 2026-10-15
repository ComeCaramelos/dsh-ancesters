/**
 * Browser half — the shared card stylesheet + its idempotent injector.
 *
 * The rules and class names live in `shared.module.css`; the build's CSS-modules
 * step compiles it — minified, names scoped `hash_local` — and the blocks import
 * that map directly, the same way every shipped card consumes its own sheet.
 *
 * The injector guarantees **one** `<style>` per sheet per page: two cards from
 * two different plugins on the same page must not stack a second copy. The key
 * is the sheet's content hash, not the plugin id — a sheet, not a consumer, is
 * what is unique.
 */
import { cssText } from "./shared.module.css";

/** Key of one injected sheet: `dsh-ancesters/<content hash>`. */
export const SHEET_ID = "dsh-ancesters-" + hash(cssText);

/** The identity of one sheet — its content, never the name of who ships it. */
export function sheetId(css: string): string {
    return "dsh-ancesters-" + hash(css);
}

/** Whether one `<style>` under this sheet id already stands on the page. */
function injected(id: string): boolean {
    return document.querySelectorAll('style[data-dsh-ancesters-css="' + id + '"]').length > 0;
}

/**
 * Append the shared sheet, plus any sheet the caller carries.
 *
 * Without arguments it appends the shared sheet, which is what a card that
 * only uses the shared blocks needs. A card that ships rules of its own — the
 * ones a list or a live line wants that the shared families do not carry —
 * passes them alongside, and each sheet is keyed by its **content**: two cards
 * from two plugins on one page still stand exactly one `<style>` per distinct
 * sheet, and nobody has to decide an injection order.
 *
 * Called from `mountSettingsCard` (or a card's `apply`), never from a module
 * body: importing this module for its class names cannot have DOM side
 * effects.
 */
export function injectCardStyles(sheets?: readonly string[]): void {
    if (typeof document === "undefined") return;
    // The shared sheet always stands first: the blocks' class names mean what
    // it says, so a card that carries rules of its own still needs it.
    const wanted = [cssText, ...(sheets ?? [])].filter((sheet) => typeof sheet === "string" && sheet !== "");
    for (const sheet of wanted) {
        const id = sheetId(sheet);
        if (injected(id)) continue;
        const styleTag = document.createElement("style");
        styleTag.dataset.dshAncestersCss = id;
        styleTag.textContent = sheet;
        document.head.appendChild(styleTag);
    }
}

/**
 * One sheet's identity — content digest, then content length.
 *
 * The digest alone is 6 characters, and two distinct sheets can answer the same
 * digest; the `<style>` keyed by that digest is only injected *once*, so a
 * collision silently loses a whole sheet. The length makes two sheets that
 * collide on the digest differ in the id.
 */
function hash(text: string): string {
    let value = 0x811c9dc5 >>> 0;
    for (let index = 0; index < text.length; index++) {
        value ^= text.charCodeAt(index);
        value = Math.imul(value, 0x01000193) >>> 0;
    }
    return value.toString(36).padStart(6, "0").slice(0, 6) + "-" + text.length.toString(36);
}
