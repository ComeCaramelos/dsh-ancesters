/**
 * Structural views of the modules the shell seeds into `window.__ModuleLoader__`.
 *
 * The `@deepseek-ai/dsh-client-*` ids resolve inside the running GUI's module
 * table and appear in no local `node_modules` tree (no `@types/*` for them
 * exist), so they are described here — the same structural-view idiom the host
 * half uses for services it does not depend on — rather than imported. `react`
 * and `react/jsx-runtime` are baseline modules that DO have local types
 * (`@types/react` is a devDependency, kept external by the bundler).
 *
 * Keep the shapes as narrow as what `ancesters` actually calls: widening them to
 * match upstream's real surface is a drift risk the tests cannot catch.
 */
declare module "@deepseek-ai/dsh-client-store" {
    /** A subscriber store: `getSnapshot` is stable identity, `set` notifies. */
    export interface SnapshotStore<T> {
        subscribe(listener: () => void): () => void;
        getSnapshot(): T;
        set(next: T): void;
    }

    /** Create a snapshot store seeded with `initial`. */
    export function createSnapshotStore<T>(initial: T): SnapshotStore<T>;
}

declare module "@deepseek-ai/dsh-client-ui-primitives" {
    /** A node rendered by a primitive — structural `unknown`, same idiom. */
    type ReactNode = unknown;

    /**
     * A closed-choice dropdown: the list, the portal and the keyboard handling
     * belong to the primitive; the card only supplies the `anchor` it hangs off
     * and the list. Only the subset `ancesters` cards use is described;
     * widening this shape is a drift risk the tests cannot catch.
     */
    export const Menu: (props: {
        open: boolean;
        onClose: () => void;
        items: readonly { id: string; label: string }[];
        /** Id rendered selected ("" = nothing selected). */
        selectedId?: string;
        /** The chosen id; opening off is the consumer's business. */
        onSelect?: (id: string) => void;
        /** Alignment of the opened list against the anchor. */
        align?: "start" | "end";
        /** Which side of the anchor the list opens toward (composer pills open "top"). */
        side?: "top" | "bottom";
        /** Render the list through a portal (the row page clips overflow). */
        portal?: boolean;
        /** The control the list is anchored to (a button, typically). */
        anchor?: ReactNode;
    }) => any;

    /**
     * A boolean switch: only the control, named through `label` (its
     * accessible name). Only this subset is used.
     */
    export const Switch: (props: {
        checked: boolean;
        label: string;
        disabled?: boolean;
        onChange?: () => void;
    }) => any;
}
