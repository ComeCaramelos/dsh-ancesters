/**
 * Browser half — the surfaces the card controller reads.
 *
 * Since 0.2 the configuration form *is* the whole surface:
 * `configForms.get(entryId)` answers the live resolved section through
 * `getSnapshot`, pushes every change through `subscribe` — user commits and the
 * live Host commits alike, both of which advance the served revision — and
 * `mutate` is the single write door. Everything a card renders, user-authored
 * or host-live, is read out of that one resolved section, because the Host
 * publishes its live state into the very same volatile fields the form edits.
 *
 * `ConfigPageForm` is the same form seen from the other side: the row page hands
 * it over with `view: "page"`, where its own `mutate` becomes the door — so a
 * card edit and the page's own save can never fence on two different revisions.
 */

/**
 * Snapshot answers by one configuration form.
 */
export interface ConfigFormSnapshot {
    /** `loading` until the first accepted section, `ready` while one stands,
     * `unavailable` when nothing serves the entry. */
    status: "loading" | "ready" | "unavailable";
    /** The live resolved section — every field the card reads, undefined before
     * the first acceptance. */
    value?: Record<string, unknown> | undefined;
    /** The raw user layer (what the profile patch carries) — the fields a
     * person changed off the row's own answers. Absent on a form that serves
     * no layers. */
    user?: Record<string, unknown> | undefined;
    /** Revision fencing the next write; undefined before the first Host view. */
    revision?: number | undefined;
    /** Whether the Host document accepts writes. */
    writable?: boolean;
    /** `host` syncs with the Host document; `memory` keeps it process-local. */
    mode?: "host" | "memory";
}

/** One field operation carried by `ConfigForm.mutate`. */
export type ConfigFormOp =
    | {
          op: "set";
          /** The field path inside the served section — one scalar field, or
           * the section root when the path is empty. */
          path: string[];
          value: unknown;
      }
    | {
          /** Drop the field from what is persisted (the live keys, on every
           * write — see the controller's write door). */
          op: "unset";
          path: string[];
      };

/** The shared configuration form over one Host entry. */
export interface ConfigForm {
    getSnapshot(): ConfigFormSnapshot;
    /** Every snapshot replacement pushes; live Host commits included. Returns
     * the subscription's disposer. */
    subscribe(fn: () => void): () => void;
    /** Ordered field operations, fenced on the revision they carry.
     * `true` accepted, `false` refused; a transport failure rejects. */
    mutate(ops: readonly ConfigFormOp[], expectedRevision?: number): Promise<boolean>;
}

/** The form handle the row-configuration page carries (`view: "page"`). */
export interface ConfigPageForm {
    state: ConfigFormSnapshot;
    mutate(ops: readonly ConfigFormOp[], expectedRevision?: number): Promise<boolean>;
}

/** What one card's store holds, shaped by the descriptor's holes. */
export interface CardSnapshot {
    /** Whether anything serves this entry at all. */
    available: boolean;
    /** Whether the Host document accepts writes. */
    writable: boolean;
    /** Every field the card reads — served answers overlaid by staged drafts. */
    values: Record<string, unknown>;
    /** Fields the user layer carries — what an Overridden badge is drawn from.
     * A field answered only by the row's own configuration is not listed. */
    overridden: readonly string[];
    /** The latest error the Host answered. */
    lastError: string;
    /** Whether a staged edit is standing unapplied. */
    dirty: boolean;
    /** Whether a write is crossing the wire. */
    saving: boolean;
    /** Whether a write the Host refused stands. */
    failed: boolean;
    /** The last action-side failure (never a Host answer). */
    actionError: string;
    /** One pending failure notice the body mounts. */
    notice: { seq: number; kind: "error" | "stall"; text: string } | null;
}

/** Which fields stage and which land immediately — the whole shape the card
 * controller answers to. */
export interface CardFields {
    /** Fields edited as a staged draft (apply/discard semantics). */
    staged?: readonly string[];
    /** Fields written on the spot (their purpose is the Host action behind
     * them: rows, selections, trigger nonces). */
    immediate?: readonly string[];
    /** Trigger fields — an immediate write whose value is `Date.now()`, armed
     * against a settle predicate when the caller passes one. */
    triggers?: readonly string[];
    /** Live-mirror keys: fields the Host answers with, never user-authored.
     * Listed so the descriptor can say what is mirror, not value. */
    liveKeys?: readonly string[];
}

/** The card store's initial state — nothing serves anything. */
export function nothingCardSnapshot(): CardSnapshot {
    return {
        available: false,
        writable: false,
        values: {},
        overridden: [],
        lastError: "",
        dirty: false,
        saving: false,
        failed: false,
        actionError: "",
        notice: null
    };
}
