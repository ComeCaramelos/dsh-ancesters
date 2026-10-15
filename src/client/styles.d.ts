/**
 * `@comecaramelos/dsh-ancesters/styles` — types.
 *
 * The shared stylesheet compiles into the bundle once (`scripts/build-client.mjs`
 * → `dsh-css-modules`): minified text + the class map the blocks import.
 */

/**
 * Append the shared sheet once — plus, when a card carries rules of its own,
 * those sheets alongside. Idempotent by **sheet content**, not by plugin: two
 * cards from two plugins never stack a second copy of anything.
 */
export declare function injectCardStyles(sheets?: readonly string[]): void;

/** Key of the injected `<style>`: `dsh-ancesters/<content hash>`. */
export declare const SHEET_ID: string;

/** The identity of any sheet, decided by its content alone. */
export declare function sheetId(css: string): string;
