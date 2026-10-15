/**
 * Browser half — the card's data controller.
 *
 * One store per mounted card, projected off the entry's configuration form and
 * answered back through that form's own write door. Nothing decides on its own
 * where a card's edit lands: every read comes off the served section, every
 * write goes through `mutate` fenced on the mirrored revision, and every live
 * Host answer arrives by subscription — the only timer here is a settle wait's
 * own deadline (see ./wait.ts).
 *
 * Two write shapes, deliberately (contratos-dsh §4):
 *
 * * **staged** fields reach the Host only through `applyStaged()`, which writes
 *   exactly the fields that differ and clears exactly those drafts — a draft
 *   equal to the served value is not dirty and writes nothing;
 * * **immediate** fields (rows, selections, trigger nonces) write on the spot,
 *   because their whole purpose is the Host-side action behind them.
 *
 * The write door re-issues a refused pass against the re-read document, budget
 * limited (`MAX_WRITE_PASSES`): consecutive passes walk toward what the Host
 * currently answers — what a Host that keeps answering needs. Beyond the
 * budget, refusals stop meaning "read me again" and start meaning a real
 * refusal, which is *reported*, not retried.
 */
import { createSnapshotStore } from "@deepseek-ai/dsh-client-store";

import { sameValue } from "../../host/values.js";

import { nothingCardSnapshot, type CardFields, type CardSnapshot, type ConfigForm, type ConfigFormOp, type ConfigFormSnapshot, type ConfigPageForm } from "./snapshot.js";
import { settleOnRevision, type WaitHost } from "./wait.js";

/** How many times one write is issued before it is reported as refused. */
export const MAX_WRITE_PASSES = 4;

/** What one card instance is built from. */
export interface CardControllerSpec {
    fields?: CardFields;
    /** Field whose error line the card states (default: `lastError`). */
    errorField?: string;
    /** The settle deadline every host-run action waits behind. */
    settleDeadlineMs?: number;
    /** The settle hole (`settleField`): the live field whose **diff** settles a
     * host-run trigger wait — `settleTrigger(field, watch?)` watches what it
     * answers under `watch`, defaulting to this field and, with nothing
     * declared, to the trigger field itself. What moves is the answer; the
     * wall clock is only the backstop. */
    settleField?: string;
    /** A write that carries no revision fence, used for the **last** pass of
     * the write door only. On dsh 0.2.1 a settings write first reloads the
     * profile, which drops the live mirror's answers and so moves the revision
     * under the writer: while a host keeps answering, every fenced pass loses.
     * The ops are composed against the re-read document on every pass, so the
     * unfenced one still merges against what is served now. */
    unfencedMutate?: (ops: readonly ConfigFormOp[]) => Promise<boolean>;
}

/** One pending settle. */
interface Wait {
    settled: (snapshot: CardSnapshot) => boolean;
    resolve: () => void;
}

/**
 * Store, publish, and the write door — the whole card's data half.
 */
export class CardController implements WaitHost {
    /** Disposed — every late answer and timer bails on this flag first. */
    disposed = false;
    /** The armed stall-deadline timer (owned by ./wait.ts). */
    settleTimer: unknown = null;
    readonly store: { subscribe(fn: () => void): () => void; getSnapshot(): CardSnapshot; set(next: CardSnapshot): void };

    private readonly fields: CardFields;
    private readonly errorField: string;
    private readonly settleDeadlineMs: number | undefined;
    private readonly settleField: string | undefined;
    /** The last pass of the write door, when the mount can issue it unfenced. */
    private readonly unfencedMutate: ((ops: readonly ConfigFormOp[]) => Promise<boolean>) | undefined;
    /** The form the entry's row page handed (`view: "page"`), if any. */
    private pageForm: ConfigPageForm | undefined;
    private readonly formRef: ConfigForm | undefined;
    private unsubscribe: (() => void) | undefined;
    /** Staged drafts: only fields that differ from what is served. */
    private readonly draft: Record<string, unknown> = {};
    /** The last served (undrafted) answers, recomputed on every push. */
    private served: Record<string, unknown> = {};
    private saving = false;
    private failed = false;
    private actionError = "";
    private noticeQueue: { seq: number; kind: "error" | "stall"; text: string } | null = null;
    private noticeSeq = 0;
    /** Every armed settle; keyed against a published snapshot. */
    private readonly waits: Wait[] = [];

    constructor(form: ConfigForm | undefined, spec: CardControllerSpec = {}) {
        this.fields = spec.fields ?? {};
        this.errorField = spec.errorField ?? "lastError";
        this.settleDeadlineMs = spec.settleDeadlineMs;
        this.settleField = spec.settleField === undefined || spec.settleField === "" ? void 0 : spec.settleField;
        this.unfencedMutate = spec.unfencedMutate;
        this.formRef = form;
        this.store = createSnapshotStore<CardSnapshot>(nothingCardSnapshot());
        // A served answer replaces whatever an action said last: a refused write
        // stands on the error line until the Host answers again, never longer.
        this.unsubscribe = form === undefined ? undefined : form.subscribe(() => {
            this.actionError = "";
            this.publish();
        });
        this.publish();
    }

    /** Adopt the form the row page hands with `view: "page"` (identity guarded:
     * an unchanged adopt is a no-op, keeping its publish out of the render). */
    adoptForm(form?: ConfigPageForm): void {
        if (this.disposed) return;
        const next = form === void 0 ? undefined : form;
        if (this.pageForm === next) return;
        this.pageForm = next;
        // The handed snapshot can already stand ahead of the last read:
        // re-publish so the card never renders what the page moved past.
        this.publish();
    }

    /** The card's store is what the card body renders. */
    getSnapshot(): CardSnapshot {
        return this.store.getSnapshot();
    }

    /** Whether anything serves this entry. */
    available(): boolean {
        return this.store.getSnapshot().available === true;
    }

    /** Read one field off the current snapshot (drafts overlaid). */
    value(field: string): unknown {
        return this.store.getSnapshot().values[field];
    }

    /** One field as the Host serves it, drafts left out — what a staged edit
     * that lands back on it is compared against. */
    servedValue(field: string): unknown {
        return this.documentValue(field);
    }

    /** One field as the served document answers it (what a wait arms against). */
    private documentValue(field: string): unknown {
        const snapshot = this.readSnapshot();
        if (snapshot === undefined || snapshot.status !== "ready" || snapshot.value === undefined) return void 0;
        return (snapshot.value as Record<string, unknown>)[field];
    }

    /**
     * Staged edit: save one value as a draft. A draft equal to what is served
     * is not dirty — it stages nothing and dirties nothing.
     */
    stage(field: string, value: unknown): void {
        if (this.disposed) return;
        const servedValue = this.served[field];
        if (valuesEqual(servedValue, value)) {
            delete this.draft[field];
        } else {
            this.draft[field] = value;
        }
        this.publish();
    }

    /** Drop every staged draft: the card answers with what is served. */
    discard(): void {
        if (this.disposed) return;
        for (const key of Object.keys(this.draft)) delete this.draft[key];
        this.failed = false;
        this.publish();
    }

    /** Apply exactly the staged fields. Accepted: the drafts clear with the
     * Host's answers. Refused: the drafts stand, `failed` says so. */
    async applyStaged(): Promise<boolean> {
        if (this.disposed) return false;
        const staged = Object.entries(this.draft);
        if (staged.length === 0) return true;
        this.saving = true;
        this.publish();
        const ops: ConfigFormOp[] = staged.map(([field, value]) => ({ op: "set", path: [field], value }));
        const accepted = await this.writeDoor(() => ops);
        if (accepted) {
            for (const field of Object.keys(this.draft)) delete this.draft[field];
            this.failed = false;
        } else {
            this.failed = true;
            this.actionError = "configuration write refused";
        }
        this.saving = false;
        this.publish();
        return accepted;
    }

    /** Immediate write of one field — rows, selections: written on the spot. */
    async writeField(field: string, value: unknown): Promise<boolean> {
        if (this.disposed) return false;
        const accepted = await this.writeDoor(() => [{ op: "set", path: [field], value }]);
        this.publish();
        return accepted;
    }

    /** Return one field to what the row's own configuration answers: the field
     * leaves the user layer (an `unset`), and any draft standing over it goes. */
    async resetField(field: string): Promise<boolean> {
        if (this.disposed) return false;
        const accepted = await this.writeDoor(() => [{ op: "unset", path: [field] }]);
        if (accepted) delete this.draft[field];
        this.publish();
        return accepted;
    }

    /**
     * Trigger write — a nonce: the value is always a stamp that moved off what
     * stood before it (`nextStamp`), so a later commit always reads as a diff.
     * Returns as soon as the write lands; waiting for the Host *run* is the job
     * of `settle` — armed before this crosses the wire, so nothing can slip
     * between. A stamp that stands where it stood answers no run at all: two
     * actions inside one millisecond must not read as nothing happened.
     */
    async writeTrigger(field: string): Promise<boolean> {
        return this.writeDoor((document) => [{ op: "set", path: [field], value: nextStamp(document[field]) }]);
    }

    /** Write a trigger and wait for the mirror to satisfy `settled`. */
    settleAndTrigger(settled: (snapshot: CardSnapshot) => boolean, field: string): Promise<void> {
        return settleOnRevision(this, settled, () => this.writeTrigger(field), this.settleDeadlineMs);
    }

    /** The immediate-write shape of `settleAndTrigger`: write one field on the
     * spot (a selection, a saved list) and wait for the Host run behind it to
     * satisfy `settled` — the wait armed before the write crosses the wire. */
    settleAndWrite(settled: (snapshot: CardSnapshot) => boolean, field: string, value: unknown): Promise<void> {
        return settleOnRevision(this, settled, () => this.writeField(field, value), this.settleDeadlineMs);
    }

    /**
     * Entry trigger — the keyed nonce (`entryActions` hole): stamps a moved
     * value **under `key`** inside the field's map, keeping every other row's
     * stamp, and writes the whole map through the door. The Host's trigger diff
     * answers per key (`host/adapter/form.ts`), so exactly the row that stamped
     * fires its run. The merge is composed inside the door (what the document
     * stands on now), never from what this half last rendered.
     */
    async writeEntryTrigger(field: string, key: string | number): Promise<boolean> {
        const wanted = String(key);
        return this.writeDoor((document) => {
            // The whole map goes through the door, but it is merged from what
            // the document stands on **now**: two rows stamped in one turn must
            // not erase each other, and the Host's diff answers per key.
            const current = document[field];
            const stamps: Record<string, unknown> = current !== null && typeof current === "object" && !Array.isArray(current)
                ? { ...(current as Record<string, unknown>) }
                : {};
            stamps[wanted] = nextStamp(stamps[wanted]);
            return [{ op: "set", path: [field], value: stamps }];
        });
    }

    /** The keyed shape of `settleAndTrigger`: arm the wait, write the entry
     * nonce, settle when `settled` stands. */
    settleAndTriggerEntry(settled: (snapshot: CardSnapshot) => boolean, field: string, key: string | number): Promise<void> {
        return settleOnRevision(this, settled, () => this.writeEntryTrigger(field, key), this.settleDeadlineMs);
    }

    /** Host-run settle on the `settleField` hole: write the trigger for
     * `triggerField`, settle once what `watchField` answers moves off the value
     * it stood at when the wait was armed — the diff is the answer, the wall
     * clock only the backstop. With no `watchField` declared anywhere, the
     * trigger field itself is what must move.
     *
     * Both sides read the **served document**: the store is what the body
     * renders, and at arm time it may not have answered the field at all (nothing
     * published yet) — armed against that, every answer reads as a move. */
    settleTrigger(triggerField: string, watchField?: string): Promise<void> {
        const watched = watchField ?? this.settleField ?? triggerField;
        // Armed off the served document, not the store: the store is what the
        // body renders, and at arm time it may not have answered this field at
        // all (nothing published yet) — armed off that, *any* answer would read
        // as a move.
        const armed = this.documentValue(watched);
        return settleOnRevision(
            this,
            () => !sameValue(this.documentValue(watched), armed),
            () => this.writeTrigger(triggerField),
            this.settleDeadlineMs
        );
    }

    /** The keyed shape of `settleTrigger`: the wait answers **per entry** — what
     * `watchField` answers for `key` moves off what it answered when armed. A
     * mirror shaped as a list of lines answers it by the line's own `id`/`key`,
     * which is the shape a live mirror really carries. */
    settleEntryTrigger(triggerField: string, key: string | number, watchField?: string): Promise<void> {
        const watched = watchField ?? this.settleField ?? triggerField;
        const wanted = String(key);
        const armed = keyedAnswer(this.documentValue(watched), wanted);
        return settleOnRevision(
            this,
            () => !sameValue(keyedAnswer(this.documentValue(watched), wanted), armed),
            () => this.writeEntryTrigger(triggerField, key),
            this.settleDeadlineMs
        );
    }

    /** Arm one predicate against the next publish (the wait surface). */
    settleOn(settled: (snapshot: CardSnapshot) => boolean): { settle: Promise<void>; cancel: () => void } {
        let resolve: () => void = () => void 0;
        const settle = new Promise<void>((done) => {
            resolve = done;
        });
        const wait: Wait = { settled, resolve };
        this.waits.push(wait);
        return {
            settle,
            cancel: () => {
                const index = this.waits.indexOf(wait);
                if (index >= 0) this.waits.splice(index, 1);
                // An armed wait that leaves without settling must resolve to
                // no one waiting.
                resolve();
            }
        };
    }

    /** Stage one failure notice for the body's toast host. */
    noteNotice(kind: "error" | "stall", text: unknown): void {
        this.noticeSeq += 1;
        this.noticeQueue = { seq: this.noticeSeq, kind, text: String(text ?? "") };
        this.publish();
    }

    /** Drop one announced notice (by `seq`). */
    clearNotice(seq: number): void {
        if (this.noticeQueue !== null && this.noticeQueue.seq === seq) this.noticeQueue = null;
        this.publish();
    }

    /** Surface a refused or failed write as the card's own error line. */
    noteError(error: unknown): void {
        this.actionError = String(error instanceof Error ? error.message : error);
        this.publish();
    }

    /** Release everything: subscriptions, settle, timers. */
    dispose(): void {
        this.disposed = true;
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        this.pageForm = undefined;
        for (const wait of [...this.waits]) wait.resolve();
        this.waits.length = 0;
        if (this.settleTimer !== null && this.settleTimer !== undefined) {
            clearTimeout(this.settleTimer as ReturnType<typeof setTimeout>);
            this.settleTimer = null;
        }
    }

    /** Everything a registered card body receives — the same object for every
     * render (identity stable), so a re-render cannot disturb the store. */
    inject(): Record<string, unknown> {
        return {
            store: this.store,
            controller: this,
            fields: this.fields
        };
    }

    /** Push the served answers, overlaid by drafts, into the store. */
    private publish(): void {
        if (this.disposed) return;
        const previous = this.store.getSnapshot();
        const snapshot = this.readSnapshot();
        let values: Record<string, unknown> = {};
        let overridden: string[] = [];
        let available = false;
        let writable = false;
        if (snapshot !== undefined && snapshot.status === "ready" && snapshot.value !== undefined) {
            available = true;
            writable = snapshot.writable !== false;
            values = { ...snapshot.value };
            const user = snapshot.user;
            if (user !== null && typeof user === "object") overridden = Object.keys(user);
            for (const [field, value] of Object.entries(this.draft)) values[field] = value;
        } else {
            // Nothing serves the entry (loading, or unavailable): no drafts
            // stand over nothing, and no armed wait can settle.
            for (const key of Object.keys(this.draft)) delete this.draft[key];
            this.releaseWaits();
        }
        this.served = snapshot !== undefined && snapshot.status === "ready" && snapshot.value !== undefined ? { ...snapshot.value } : {};
        this.store.set({
            available,
            writable,
            values,
            overridden,
            lastError: typeof values[this.errorField] === "string" ? String(values[this.errorField]) : "",
            dirty: Object.keys(this.draft).length > 0,
            saving: this.saving,
            failed: this.failed,
            actionError: this.actionError,
            notice: this.noticeQueue
        });
        // Every armed predicate answers against what just landed.
        const state = this.store.getSnapshot();
        for (const wait of [...this.waits]) {
            if (wait.settled(state) === true) {
                this.waits.splice(this.waits.indexOf(wait), 1);
                wait.resolve();
            }
        }
    }

    /** What every read stands on: the shared form's mirror, which subscribes
     * and so moves with every Host answer. The page's handed `state` is a
     * snapshot taken when the page rendered — only the fallback when no shared
     * form stands; the page form is adopted as the write **door**, not as the
     * source. */
    private readSnapshot(): ConfigFormSnapshot | undefined {
        if (this.formRef !== undefined) {
            try {
                return this.formRef.getSnapshot();
            } catch {
                // fall through to the page's own handle
            }
        }
        return this.pageForm?.state;
    }

    /**
     * The write door — a refused pass is re-issued against the re-read document
     * until the budget runs out, then the refusal is *reported*.
     *
     * The door takes what the ops are **made of**, not the ops themselves, for
     * one reason: anything that has to carry what the document already says (a
     * keyed trigger's stamp map, a stamp that must move) is composed against
     * what the document says *now*, on every pass. Composing it once from what
     * this half last rendered would re-issue a merge made against a document
     * that already moved — and drop the other row's stamp on the floor.
     */
    private async writeDoor(
        compose: (document: Record<string, unknown>) => readonly ConfigFormOp[]
    ): Promise<boolean> {
        for (let pass = 0; pass < MAX_WRITE_PASSES; pass++) {
            const snapshot = this.readSnapshot();
            if (snapshot === undefined || snapshot.status !== "ready") return false;
            const document = (snapshot.value ?? {}) as Record<string, unknown>;
            const ops = withLiveCleared(compose(document), this.fields.liveKeys);
            // The door is called as a method of its form — a real form fences
            // and recovers through its own `this`, and a reference pulled off it
            // and called bare throws before the write reaches the wire. And it is
            // handed **no** revision: the form fences each pass on the revision
            // it mirrors, which moves with every Host answer it has folded in; a
            // revision read on this side is already behind under a running Host
            // (measured in dsh-chrome-mcp: a pick refused pass after pass until
            // it never landed).
            const pageForm = this.pageForm;
            const formRef = this.formRef;
            const door = pageForm !== undefined
                ? (next: readonly ConfigFormOp[]) => pageForm.mutate(next)
                : formRef !== undefined
                    ? (next: readonly ConfigFormOp[]) => formRef.mutate(next)
                    : void 0;
            if (door === void 0) return false;
            const last = pass === MAX_WRITE_PASSES - 1 && this.unfencedMutate !== undefined;
            try {
                const accepted = last ? await this.unfencedMutate!(ops) : await door(ops);
                if (accepted === true) return true;
            } catch {
                // The document moved: re-read and issue once more, inside the
                // budget.
            }
        }
        return false;
    }

    /** Nothing serves: no wait can settle. */
    private releaseWaits(): void {
        for (const wait of [...this.waits]) {
            this.waits.splice(this.waits.indexOf(wait), 1);
            wait.resolve();
        }
    }
}

/**
 * Every write clears the live-mirror keys. A settings write persists every
 * volatile field the entry currently carries, and the mirror's answers are
 * carried there: without the clear, a save writes the Host's live state into
 * the profile file (measured on dsh 0.2.1-rc.3). The host-side persister does
 * the same on its own writes; the mirror re-asserts right after either.
 */
function withLiveCleared(ops: readonly ConfigFormOp[], liveKeys: readonly string[] | undefined): readonly ConfigFormOp[] {
    if (liveKeys === undefined || liveKeys.length === 0) return ops;
    const written = new Set(ops.map((op) => op.path[0]));
    const clears = liveKeys.filter((key) => !written.has(key)).map((key): ConfigFormOp => ({ op: "unset", path: [key] }));
    return clears.length === 0 ? ops : [...ops, ...clears];
}

/** Field-diff equality: lists and plain objects compared by content (the
 * staged fields are lists and records). One rule with the host half — object
 * key order never reads as a change (`sameValue`, hueco H2). */
function valuesEqual(a: unknown, b: unknown): boolean {
    return sameValue(a, b);
}

/** What one keyed live answer answers for `key`.
 *
 * A keyed live field answers it as a map (`{ [key]: what that entry answered }`)
 * or as a list of lines carrying their own `id`/`key` — the two shapes a mirror
 * actually takes. With neither shape the wait cannot answer *per entry*, so it
 * answers against the field's whole value and says nothing about which row moved.
 */
function keyedAnswer(value: unknown, key: string): unknown {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) {
        const rows = value as readonly Record<string, unknown>[];
        const row = rows.find((item) => identityOf(item) === key);
        // Rows carrying their own identity answer per entry, absent one
        // included: the entry leaving is a diff of the wait's watched answer.
        if (rows.some((item) => identityOf(item) !== void 0)) return row;
        return value;
    }
    if (Object.prototype.hasOwnProperty.call(value, key)) return (value as Record<string, unknown>)[key];
    return value;
}

/** One live row's own identity, as a mirror spells it. */
function identityOf(row: unknown): string | undefined {
    if (row === null || typeof row !== "object") return void 0;
    const claimed = (row as Record<string, unknown>).id ?? (row as Record<string, unknown>).key;
    if (typeof claimed === "string") return claimed;
    if (typeof claimed === "number") return String(claimed);
    return void 0;
}

/** One trigger's next stamp: a wall-clock value that **must** differ from the
 * one standing. Two actions inside the same millisecond otherwise answer the
 * same stamp, and the Host's diff — the only thing that launches anything —
 * sees no change. */
function nextStamp(previous: unknown): number {
    const standing = typeof previous === "number" && Number.isFinite(previous) ? previous : 0;
    return Math.max(Date.now(), standing + 1);
}
