/**
 * Browser half — `mountSettingsCard`.
 *
 * The order is fixed (contratos-dsh §8), and it is *the* contract: styles →
 * locales → controller → row registration.
 *
 * 1. **Styles** go in once per sheet — not per card.
 * 2. **Locales** register the merged dictionaries under the namespace the
 *    descriptor declares.
 * 3. **The controller** projects the entry's configuration form; disposing it
 *    goes with the effect.
 * 4. **The row registers unconditionally** into `plugins.row.config`, keyed by
 *    the package and the row id (or, with `placement: "bundle"`, into
 *    `plugins.bundle.config` keyed by the bundle package, on the bundle's own
 *    page) — the page owns the container and the identity
 *    line, and asks for two shapes: `summary` and `page`. A card that can read
 *    nothing renders nothing; there is no card shell and the error line rides
 *    the body.
 *
 * Everything a consumer's body composes arrives through the descriptor's holes
 * — blocks bind to fields and actions, never import services.
 */
import * as react from "react";
import { jsx } from "react/jsx-runtime";

import { rowConfigKey } from "../host/identity.js";
import { Blocks, ComposerPill, ErrorLine } from "./blocks/index.js";
import type { ComposerPillSpec } from "./blocks/pill.js";
import STYLES from "./styles/shared.module.css";
import { CardController } from "./controller/controller.js";
import type { CardFields, CardSnapshot, ConfigForm, ConfigFormOp, ConfigPageForm } from "./controller/snapshot.js";
import { DICTIONARIES, LOCALE_NAMESPACE, mergeDictionaries } from "./locales/index.js";
import { mountToastMirror } from "./toasts.js";
import { injectCardStyles } from "./styles/index.js";

/** One declared block of a card body. */
export interface CardBlockSpec {
    /** A name from the shared block set (`RowsBlock`, `PickerBlock`, …) or the
     * block component itself. */
    block: string | ((props: any) => unknown);
    /** The field this block edits (staged or immediate, per `fields`). */
    field?: string;
    /** Fields this block renders as live answers (never edited). */
    liveKeys?: readonly string[];
    /** Static props handed to the block every render. */
    props?: Record<string, unknown>;
    /** Props computed from the current snapshot, merged last. Gets the copy
     * door as the third argument — the same `t` every component receives, so a
     * bind that renders copy never re-derives it (hueco: `t` en `bind`). */
    bind?: (snapshot: CardSnapshot, controller: CardController, t: (key: string) => string) => Record<string, unknown>;
    /** Action hole: the block's write shape, composed by the shared half. */
    action?: "stage" | "apply" | "discard" | "write" | "trigger" | ((controller: CardController) => (value?: unknown) => unknown);
    /** Render nothing when the entry serves nothing. */
    hideWhenUnavailable?: boolean;
}

/** The whole descriptor that makes one card. */
export interface SettingsCardSpec {
    /** The profile entry id this card's row is keyed by. */
    entryId: string;
    /** Package identity for the row key (`<pkg>#<entryId>`). */
    pluginId?: string;
    /**
     * The bundle whose patch declares the row, used for the row key instead of
     * `pluginId` when the two are separate packages. The plugin manager answers a
     * component row's configuration page under `<bundle>#<row id>` — the bundle
     * the person installed, not the package the row runs — so a plugin that is
     * not its own bundle declares it here or its page never opens. Defaults to
     * `pluginId`, for a plugin standing on its own patch.
     */
    bundleId?: string;
    /**
     * Where the Plugins page draws the card (the `placement` hole):
     *
     * - `"row"` (default) — the component row's own page
     *   (`plugins.row.config`, keyed `<bundle>#<row id>`): the bundle's page
     *   lists the row, and the card opens one step further in;
     * - `"bundle"` — the bundle's own page (`plugins.bundle.config`, keyed by
     *   the bundle package name): the card stands on the page the list opens,
     *   above the bundle's rows. Only the `page` shape is asked for there, and
     *   the page hands no form of its own, so writes take the shared form.
     */
    placement?: "row" | "bundle";
    /** Locale namespace to register (default: `dshAncesters`, merged with the
     * shared dictionaries below the plugin's own). */
    localeNamespace?: string;
    /** Which fields stage, which land immediately, which are triggers, which
     * are live. */
    fields?: CardFields;
    /** The body: blocks, in order. Empty renders the error line alone. */
    blocks?: readonly CardBlockSpec[];
    /** The plugin's own dictionaries (win over the shared keys). */
    locale?: Record<string, Record<string, string>>;
    /**
     * One-line summary render (the row's collapsed state). It gets the copy
     * lookup the page gets, so a summary that shows `key` instead of what the
     * row says is a bug of the shared half, not of the consumer (rule H7).
     */
    renderSummary?: (snapshot: CardSnapshot, t: (key: string) => string) => unknown;
    /** Staged fields the apply button states (locale keys). */
    showApplyLine?: boolean;
    /** Anything answering beyond the form (e.g. the Host answers the error
     * field under a different name). */
    errorField?: string;
    /** The settle deadline every host-run action waits behind. */
    settleDeadlineMs?: number;
    /** The body's own error line under the blocks (default `true`). `false`
     * for a card whose blocks already state the error themselves — a second
     * line would say the same thing twice. */
    errorLine?: boolean;
    /** The `settleField` hole: the live field whose diff settles the card's
     * host-run waits (`controller.settleTrigger(field)` watches this when the
     * action does not name its own). */
    settleField?: string;
    /** The `toasts` hole: mount the page-wide toast root that renders the
     * notices the controller stages (stalls, write failures). `true` stands
     * one up over the page (exactly one root per page, however many cards ask
     * for it); `{ host }` renders it inside a caller-owned element instead.
     * Nothing renders without it — the notices still stage onto the snapshot,
     * the DOM mount is the only hole here. */
    toasts?: boolean | {
        host?: unknown;
        dismissMs?: number;
        /** The consumer's own reading of a notice (see `ToastMirrorOptions`). */
        text?: (notice: { kind: "error" | "stall"; text: string }, snapshot: CardSnapshot, t: (key: string) => string) => string;
    };
    /**
     * The `composer` hole (R6): pills in the conversation input's tool row
     * (`conversation.input.left`, the seat the shell's own mode/model pills
     * take), drawn off the **same** controller and store as the card — so a
     * pick anywhere reads everywhere without a second subscription. `bind`
     * answers zero or more pills from the snapshot; zero draws nothing. The
     * consumer owns what a pick means (`onSelect`), never the slot.
     */
    composer?: {
        /** Stable id of this consumer's entry in the slot (a `list` slot). */
        id: string;
        bind(snapshot: CardSnapshot, controller: CardController, t: (key: string) => string): readonly ComposerPillSpec[];
    };
}

/** What a plugin re-exports as its own browser body. */
export interface MountedSettingsCard {
    /** The loader entry: registers styles, locales, controller and the row. */
    apply(ctx: BrowserCardContext): void;
    /** Services this body needs from the shell. */
    inject: readonly string[];
}

/** The shell surfaces a card mounts over. */
export interface BrowserCardContext {
    effect<T>(setup: () => (() => void) | void, label?: string): void;
    locale?: {
        register(namespace: string, dicts: Record<string, Record<string, string>>): void;
        bind(namespace: string): (key: string) => string;
    };
    configForms?: { get(entryId: string): ConfigForm | undefined };
    slots?: {
        inject(slot: string, register: () => void): void;
        register(
            spec: { name: string; key?: string; id?: string; locale: string; inject: () => Record<string, unknown> },
            Component: (props: any) => unknown
        ): void;
    };
    logger?: { error(...args: unknown[]): void };
    /** The shell's remote API; the card injects `remote.settings` for the
     * unfenced last write pass. */
    remote?: { settings?: { mutate?: (ns: string, ops: readonly ConfigFormOp[], expectedRevision: number | undefined) => unknown } };
}

/** The unfenced settings write the card's last write pass issues, or undefined
 * when this shell serves no `remote.settings` (every pass then stays fenced). */
function unfencedSettingsWrite(ctx: BrowserCardContext, ns: string): ((ops: readonly ConfigFormOp[]) => Promise<boolean>) | undefined {
    const settings = ctx.remote?.settings;
    const mutate = settings?.mutate;
    if (settings === undefined || typeof mutate !== "function") return undefined;
    return async (ops) => {
        try {
            // The client API counts its arguments: the absent fence is passed
            // explicitly (`settings/mutate expected 3 argument(s), got 2`).
            const response = (await mutate.call(settings, ns, ops, undefined)) as { ok?: unknown } | undefined;
            return response?.ok === true;
        } catch {
            return false;
        }
    };
}

/** What one block render answers from. */
export interface CardBodyProps {
    snapshot: CardSnapshot;
    controller: CardController;
    view: "summary" | "page";
    /** The locale bound to this card's namespace. */
    t: (key: string) => string;
}

/**
 * Mount one settings card over its descriptor. A bare `apply(ctx)` without a
 * descriptor is always an error: the shared card machinery has no identity of
 * its own.
 */
export function mountSettingsCard(spec?: SettingsCardSpec): MountedSettingsCard {
    if (spec === undefined || typeof spec !== "object" || Array.isArray(spec)) {
        throw new TypeError("mountSettingsCard: requires a descriptor object ({ entryId, fields, blocks … })");
    }
    if (typeof spec.entryId !== "string" || spec.entryId === "") {
        throw new TypeError("mountSettingsCard: the descriptor requires a non-empty `entryId`");
    }
    if (spec.pluginId !== undefined && (typeof spec.pluginId !== "string" || spec.pluginId === "")) {
        throw new TypeError("mountSettingsCard: the descriptor's `pluginId` must be a non-empty string (the row key needs the package identity)");
    }
    if (spec.bundleId !== undefined && (typeof spec.bundleId !== "string" || spec.bundleId === "")) {
        throw new TypeError("mountSettingsCard: the descriptor's `bundleId` must be a non-empty string (it is the bundle package the row key is built from)");
    }
    if (spec.placement !== undefined && spec.placement !== "row" && spec.placement !== "bundle") {
        throw new TypeError('mountSettingsCard: the descriptor\'s `placement` is "row" or "bundle"');
    }
    const namespace = spec.localeNamespace === undefined || spec.localeNamespace === "" ? LOCALE_NAMESPACE : spec.localeNamespace;
    const bundle = spec.placement === "bundle";
    const slotName = bundle ? "plugins.bundle.config" : "plugins.row.config";

    return {
        inject: ["configForms", "slots", "locale", "remote", "remote.settings"],
        apply(ctx: BrowserCardContext): void {
            if (ctx === undefined || typeof ctx !== "object" || ctx.slots === undefined || typeof ctx.slots.inject !== "function") {
                throw new TypeError("mountSettingsCard.apply: needs the browser plugin context (the shell's `slots` service)");
            }
            injectCardStyles();
            const dicts = mergeDictionaries(DICTIONARIES, spec.locale ?? {});
            if (ctx.locale !== void 0 && typeof ctx.locale.register === "function") {
                ctx.effect(() => ctx.locale!.register(namespace, dicts), `${spec.entryId}: dictionaries`);
            }
            const form = ctx.configForms === undefined ? undefined : ctx.configForms.get(spec.entryId);
            const controller = new CardController(form, {
                fields: spec.fields,
                errorField: spec.errorField,
                settleDeadlineMs: spec.settleDeadlineMs,
                settleField: spec.settleField,
                unfencedMutate: unfencedSettingsWrite(ctx, spec.entryId)
            });
            ctx.effect(() => () => controller.dispose(), `${spec.entryId}: card controller`);

            const translate: (key: string) => string =
                ctx.locale !== void 0 && typeof ctx.locale.bind === "function" ? ctx.locale.bind(namespace) : (key: string) => key;

            if (spec.toasts === true || (spec.toasts !== undefined && typeof spec.toasts === "object")) {
                const toastHost = typeof spec.toasts === "object" ? spec.toasts.host : void 0;
                const dismissMs = typeof spec.toasts === "object" ? spec.toasts.dismissMs : void 0;
                const text = typeof spec.toasts === "object" ? spec.toasts.text : void 0;
                ctx.effect(
                    () => mountToastMirror(controller, toastHost, { t: translate, dismissMs, text: text as never }),
                    `${spec.entryId}: toast host`
                );
            }

            const body = (props: any): unknown => {
                const view: "summary" | "page" = String(props?.view) === "page" ? "page" : "summary";
                // The page hands its own form door: adopting is identity-guarded.
                controller.adoptForm(props?.form === undefined ? void 0 : (props.form as ConfigPageForm));
                const snapshot = controller.getSnapshot();
                if (view === "summary") {
                    if (typeof spec.renderSummary !== "function") return null;
                    return spec.renderSummary(snapshot, translate);
                }
                if (!snapshot.available && (spec.blocks ?? []).length === 0) return null;
                const renders = (spec.blocks ?? []).map((block, index) =>
                    renderBlock(block, { snapshot, controller, view, t: translate })
                );
                const composed = renders.filter((rendered) => rendered !== null && rendered !== void 0);
                if (spec.errorLine === false) return composed;
                const error = snapshot.actionError !== "" ? snapshot.actionError : snapshot.lastError;
                const line = ErrorLine({ text: error === "" ? "" : error });
                return line === null ? composed : [...composed, line];
            };

            const pageKey = bundle ? bundleConfigKey(spec.bundleId ?? spec.pluginId) : rowConfigKey(spec.bundleId ?? spec.pluginId ?? "", spec.entryId);
            ctx.slots.inject(slotName, () => {
                ctx.slots!.register(
                    {
                        name: slotName,
                        key: pageKey,
                        locale: namespace,
                        inject: () => controller.inject()
                    },
                    body
                );
            });

            const composer = spec.composer;
            if (composer !== undefined) {
                if (typeof composer.id !== "string" || composer.id === "" || typeof composer.bind !== "function") {
                    throw new TypeError("mountSettingsCard: `composer` needs a non-empty `id` and a `bind` function");
                }
                // The shell turns `hooks.<name>` into a `use<Name>` prop that
                // subscribes the pill to the store — the card's own store, so
                // the pill re-renders on the same answers the card does.
                const pills = (props: any): unknown => {
                    const subscribe = props?.useAncestersComposer;
                    const snapshot = typeof subscribe === "function" ? subscribe((state: CardSnapshot) => state) : controller.getSnapshot();
                    const openState = react.useState("");
                    const open = openState[0];
                    const setOpen = openState[1];
                    if (snapshot?.available !== true) return null;
                    const t = typeof props?.t === "function" ? props.t : translate;
                    const declared = composer.bind(snapshot, controller, t) ?? [];
                    if (declared.length === 0) return null;
                    return jsx("span", {
                        className: STYLES.composerPills,
                        children: declared.map((pill) =>
                            jsx(
                                ComposerPill,
                                { ...pill, open: open === pill.key, setOpen: (next: boolean) => setOpen(next ? pill.key : "") },
                                pill.key
                            )
                        )
                    });
                };
                ctx.slots.inject("conversation.input.left", () => {
                    ctx.slots!.register(
                        {
                            name: "conversation.input.left",
                            // The slot is kind `list`: entries are deduped and
                            // placed by a stable `id`, not a keyed `key`.
                            id: composer.id,
                            locale: namespace,
                            inject: () => ({ hooks: { ancestersComposer: controller.store }, controller })
                        },
                        pills
                    );
                });
            }
        }
    };
}

/** The key a bundle page's card registers under: the bundle package name. */
function bundleConfigKey(pkgName: string | undefined): string {
    if (typeof pkgName !== "string" || pkgName === "") {
        throw new TypeError('mountSettingsCard: `placement: "bundle"` needs `pluginId` or `bundleId` (the bundle page is keyed by its package name)');
    }
    return pkgName;
}

/** Compose one declared block against the current body props. */
function renderBlock(block: CardBlockSpec, props: CardBodyProps): unknown {
    if (block.hideWhenUnavailable === true && props.snapshot.available !== true) return null;
    const compose: Record<string, unknown> = { ...(block.props ?? {}) };
    if (block.field !== undefined) {
        compose.value = props.snapshot.values[block.field];
        compose.field = block.field;
    }
    if (block.liveKeys !== undefined) {
        for (const liveKey of block.liveKeys) compose[liveKey] = props.snapshot.values[liveKey];
    }
    if (typeof block.bind === "function") Object.assign(compose, block.bind(props.snapshot, props.controller, props.t));
    if (block.action !== undefined) compose.action = composeAction(block.action, props.controller, block.field);
    const component = typeof block.block === "string" ? (BlocksByName as Record<string, (props: any) => unknown>)[block.block] : block.block;
    if (typeof component !== "function") return null;
    return component({ ...compose, t: props.t });
}

/** Compose the write hole into the component's `action` prop. */
function composeAction(
    action: "stage" | "apply" | "discard" | "write" | "trigger" | ((controller: CardController) => (value?: unknown) => unknown),
    controller: CardController,
    field: string | undefined
): (value?: unknown) => unknown {
    if (typeof action === "function") return action(controller);
    if (action === "stage") return (value?: unknown) => controller.stage(String(field ?? ""), value);
    if (action === "apply") return () => controller.applyStaged();
    if (action === "discard") return () => controller.discard();
    if (action === "write") return (value?: unknown) => controller.writeField(String(field ?? ""), value);
    // A plain trigger write takes no argument (scalar nonce); a row's trigger
    // hands its entry key (the `entryActions` idiom — keyed nonce).
    return (value?: unknown) => (value === undefined ? controller.writeTrigger(String(field ?? "")) : controller.writeEntryTrigger(String(field ?? ""), value as string | number));
}

/** The shared block set by name — the same functions `./blocks/index.js`
 * exports, indexed so a descriptor can name blocks with plain strings. */
const BlocksByName = Blocks;
