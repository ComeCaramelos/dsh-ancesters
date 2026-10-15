/**
 * Browser half — the toast host (the `toasts` hole).
 *
 * The controller already stages failure notices (`noteNotice`, the wait's stall
 * report) and answers them back through the snapshot; this module is only the
 * **where they land**: a page-wide root that mirrors the staged notices into
 * DOM. Nothing else renders them, and nothing else may mount it.
 *
 * The root rule is the stylesheet injector's rule: idempotency keys on the
 * *root*, never on the consumer. Two cards from two plugins mount exactly one
 * toast root; a mount with no DOM (a headless host, a loader test) is not an
 * error — the notices keep staging, only the mirror is absent.
 *
 * The mirror is deliberately dumb: one node per card carrying the staged
 * notice (its `kind` rides a dataset attribute so the stylesheet can tell an
 * error from a stall), updated in place, removed when the controller answers
 * `notice: null` — the same subscription rule every live Host answer follows.
 * What dismisses a notice (its own clock, a click) only ever asks the
 * controller to clear it; the node leaves on that answer, never on its own.
 */

import STYLES from "./styles/shared.module.css";

/** The page-wide root's identity: the idempotency key. The root carries it as
 * its `data-` attribute (the dataset spelling `dshAncestersToasts`); the
 * selector is the DOM shape a standing root is found by. */
const TOAST_ROOT_ATTRIBUTE = "dsh-ancesters-toasts";
const TOAST_ROOT_SELECTOR = "div[data-dsh-ancesters-toasts]";

/** One node per card's pending notice. */
const TOAST_ATTRIBUTE = "dsh-ancesters-toast";

/** The DOM surface the host needs — structural, so the half stays importable
 * with nothing beyond the module itself. */
interface ToastNode {
    dataset: Record<string, string>;
    /** The shared sheet's class names (root and node) — the sheet is what
     * positions the notices, and it is injected by `apply` like anywhere else. */
    className?: string;
    textContent: string;
}

interface ToastHostDocument {
    createElement(tag: string): ToastNode;
    querySelectorAll(selector: string): ArrayLike<unknown>;
    body?: unknown;
    head?: unknown;
}

interface ToastSource {
    store: { subscribe(fn: () => void): () => void; getSnapshot(): { notice: unknown } };
    /** Drop one announced notice — what a dismissal answers. */
    clearNotice?(seq: number): void;
}

/** How long a notice stands before it dismisses itself, unless the mount says
 * otherwise. */
export const TOAST_DISMISS_MS = 8000;

/** What one mirror is told beyond where it stands. */
export interface ToastMirrorOptions {
    /** The card's copy door: a stall reads `toastStall`, a failure the Host
     * answered without a line of its own reads `toastError`. */
    t?: (key: string) => string;
    /** How long a notice stands before it dismisses itself (default
     * {@link TOAST_DISMISS_MS}); `0` keeps it until the controller clears it. */
    dismissMs?: number;
    /** The consumer's own reading of a notice, when its domain says more than
     * the shared rule (a stall while a known state stands). It gets the notice,
     * the snapshot it stands on and the copy door; the shared rule answers when
     * it is absent. */
    text?: (notice: { kind: "error" | "stall"; text: string }, snapshot: unknown, t: (key: string) => string) => string;
}

/** The line one notice reads: a stall has no Host line of its own, so it
 * reads the card's copy; a failure reads what the Host said, or the copy when
 * it said nothing. */
function noticeText(notice: { kind: "error" | "stall"; text: string }, t: (key: string) => string): string {
    if (notice.kind === "stall") return t("toastStall");
    return notice.text !== "" ? notice.text : t("toastError");
}

/** One toast host: mount `source`'s notices under `host` (a caller-owned
 * element) or over the page, and return the disposer that removes the mirror.
 * No usable document (or no mount point) answers a no-op — the notices keep
 * staging, the mirror is simply not drawn. A notice dismisses itself after
 * `dismissMs`, or on a click, through the controller's own `clearNotice` — the
 * mirror never removes a node the controller still answers. */
export function mountToastMirror(source: ToastSource, host?: unknown, options: ToastMirrorOptions = {}): () => void {
    const doc = documentOf(host);
    if (doc === undefined) return () => void 0;
    const root = host === undefined || host === null ? toastRoot(doc) : (host as ToastNode & { appendChild(node: unknown): void });
    if (root === undefined || typeof (root as { appendChild?: unknown }).appendChild !== "function") return () => void 0;
    const t = typeof options.t === "function" ? options.t : (key: string) => key;
    const dismissMs = typeof options.dismissMs === "number" && options.dismissMs >= 0 ? options.dismissMs : TOAST_DISMISS_MS;

    let node: ToastNode | undefined = void 0;
    let shownSeq = -1;
    let timer: ReturnType<typeof setTimeout> | undefined = void 0;
    const dismiss = (seq: number): void => {
        if (typeof source.clearNotice === "function") source.clearNotice(seq);
    };
    const stopTimer = (): void => {
        if (timer !== void 0) clearTimeout(timer);
        timer = void 0;
    };
    const paint = (): void => {
        const snapshot = source.store.getSnapshot();
        const notice = (snapshot.notice ?? null) as { seq: number; kind: "error" | "stall"; text: string } | null;
        if (notice === null) {
            stopTimer();
            shownSeq = -1;
            if (node !== undefined) {
                (root as { removeChild(node: unknown): void }).removeChild(node);
                node = void 0;
            }
            return;
        }
        if (node === undefined) {
            node = doc!.createElement("div");
            node.className = STYLES.toast;
            (root as { appendChild(node: unknown): void }).appendChild(node);
        }
        node.dataset.dshAncestersToast = String(notice.seq);
        node.dataset.noticeKind = notice.kind;
        node.textContent = typeof options.text === "function" ? options.text(notice, snapshot, t) : noticeText(notice, t);
        const seq = notice.seq;
        (node as ToastNode & { onclick?: unknown }).onclick = () => dismiss(seq);
        // A new notice restarts the clock; a repaint of the same one does not.
        if (seq !== shownSeq) {
            shownSeq = seq;
            stopTimer();
            if (dismissMs > 0 && typeof setTimeout === "function") timer = setTimeout(() => dismiss(seq), dismissMs);
        }
    };
    const unsubscribe = source.store.subscribe(() => paint());
    paint();
    return () => {
        unsubscribe();
        stopTimer();
        if (node !== undefined) {
            (root as { removeChild(node: unknown): void }).removeChild(node);
            node = void 0;
        }
    };
}

/** Where one host document answers.
 *
 * The element the caller handed wins over the loader's `document`: a card mounted
 * inside a shadow root, an iframe, or a portal answers to *its* document, and
 * drawing the notices in `window.document` would stand them somewhere the card
 * is not. The loader's `document` is the fallback for the usual case — no host,
 * or a host with no document of its own — because the DOM lib is not guaranteed
 * to be in reach here, so both routes stay structural.
 */
function documentOf(host?: unknown): ToastHostDocument | undefined {
    const own = host !== undefined && host !== null ? ((host as { ownerDocument?: unknown }).ownerDocument as ToastHostDocument | undefined) : void 0;
    if (own !== undefined && own !== null) return own;
    return typeof document === "undefined" ? void 0 : document as unknown as ToastHostDocument;
}

/** One toast root per page: reused whenever it stands, mounted once the first
 * card asks for it (the sheet injector's idempotency, keyed by the root). */
function toastRoot(doc: ToastHostDocument): unknown {
    const standing = doc.querySelectorAll(TOAST_ROOT_SELECTOR);
    if (standing.length > 0) return standing[0];
    const root = doc.createElement("div");
    root.className = STYLES.toastRoot;
    root.dataset.dshAncestersToasts = "1";
    const container = (doc.body ?? doc.head) as { appendChild(node: unknown): void } | undefined;
    if (container === undefined) return void 0;
    container.appendChild(root);
    return root;
}

/** The attribute the root's identity rides (exported for the tests). */
export const TOAST_ROOT_KEY = TOAST_ROOT_ATTRIBUTE;
