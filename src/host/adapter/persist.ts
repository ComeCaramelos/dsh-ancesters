/**
 * The write-back channel — `persistUser`.
 *
 * When the *host itself* answers something the user should keep (a seeded
 * field, a merged row list, a composed flag), it goes through the row's own
 * patch layer: one `settings.mutate(entryId, ops)`, keyed by the same entry id
 * the card addresses by. Two rules make the boundary hold (measured live in
 * the reference checkouts, and why the shared half owns them):
 *
 * - **One `unset` per live-mirror key rides every write.** A persisted write
 *   re-persists the volatile fields it answers, so without the clear the live
 *   answers would ride the write back into the patch file — where they would
 *   outlive the run that made them. An `unset` returns the field to whatever
 *   the *row config* answers; the live-only fields simply drop out. It heals
 *   too: the first write to a row already carrying leaked live keys clears
 *   them.
 * - **The mirror is re-asserted on both sides of the write** — landed or
 *   refused. A refused write still clears the live fields (that is what the
 *   ops do), and a run whose answers would otherwise go quiet without ever
 *   re-appearing reads as the card having lost them.
 *
 * A write issued from a form commit also has to leave the commit's async
 * context (the run chain — see `host/runs.ts`), or the platform reads it as a
 * nested write transaction and refuses it. That is why persistence is
 * composed onto the chain, never called inline by a consumer.
 */
import { type SettingsFormHandle } from "./form.js";

import type { AdapterContext, SettingsForms, SettingsPathOp } from "./dsh.js";

/** A whole-field write: `{ field: value }`. */
export type UserFields = Record<string, unknown>;

/** What a persister needs. */
export interface PersisterOptions {
    /** Where the write lands (the attached form). */
    form: SettingsFormHandle;
    /** The live mirror — re-asserted on both sides of every write. */
    publishLive(): void;
    /** Every live-mirror key: cleared by one `unset` op per write. Empty — the
     * case of a card that states no mirror — answers zero unsets: there is
     * nothing to fold back, and a write carries only what it sets. */
    liveKeys?: readonly string[];
    /** Log prefix. */
    name?: string;
    /** Note hole for the warning line (defaults to the field name). */
    note?: string;
}

/** One persisted write, resolved once it landed (or refused). */
export type PersistUser = (fields: UserFields, note?: string) => Promise<void>;

/**
 * Build the consumer's `persistUser(fields)`.
 *
 * The whole `fields` object goes in as one set-op per field (one whole-row
 * write when the value is a list), so a run merges the user's own edit rather
 * than overwriting the row's field wholesale, and never writes more than the
 * fields it was handed.
 */
export function createPersister(ctx: AdapterContext, options: PersisterOptions): PersistUser {
    return async function persistUser(fields: UserFields, note?: string): Promise<void> {
        const label = note ?? options.note ?? (Object.keys(fields ?? {}).join(", ") || "configuration write");
        let settings: SettingsForms | undefined = void 0;
        let entryId = "";
        const current = options.form.current();
        if (current === undefined) {
            // Nothing is writable yet — and nothing was cleared, so there is
            // nothing to re-assert either. Say so once.
            ctx.logger?.warn(`the configuration form is not attached yet — ${label}`);
            return;
        }
        entryId = current.entryId;
        settings = current.settings;
        if (settings === void 0) {
            ctx.logger?.warn(`the settings service is not available yet — ${label}`);
            return;
        }
        const ops: SettingsPathOp[] = [];
        for (const [field, value] of Object.entries(fields ?? {})) {
            ops.push({ op: "set", path: [field], value });
        }
        for (const key of options.liveKeys ?? []) {
            ops.push({ op: "unset", path: [key] });
        }
        // No revision fence: this is the host putting its own answer into the
        // row, not an editor saving a view of it.
        try {
            await settings.mutate(entryId, ops);
            options.publishLive();
        } catch (error) {
            // The failure still answers the `unset` ops it carried — the
            // live-only fields are back at their row-config answers — so the
            // mirror goes straight back out here exactly as it did on success.
            // Without this a failed write-back silently erases every live
            // answer.
            options.publishLive();
            ctx.logger?.warn(`${label}: ${String(error)}`);
        }
    };
}
