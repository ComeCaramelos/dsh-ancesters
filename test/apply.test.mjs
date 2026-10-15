/**
 * `mountSettingsCard(...).apply(ctx)` — the fixed order, the two shapes, and
 * the error line the body owns (contratos-dsh §8).
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * A structural DOM: exactly the page shape the shared halves touch — a node
 * carrying its identity as a dataset attribute, children, and the query shapes
 * both injectors ask with (`style[data-…]`, `div[data-…]`). No jsdom, no
 * dependencies: whatever this fake answers, the real DOM answers at least.
 */
function domNode(tag) {
    const node = { tag, children: [], dataset: {}, textContent: "" };
    node.appendChild = (child) => {
        node.children.push(child);
        return child;
    };
    node.removeChild = (child) => {
        node.children = node.children.filter((candidate) => candidate !== child);
    };
    return node;
}

function domSandbox() {
    const doc = {
        createElement: domNode
    };
    doc.head = doc.createElement("head");
    doc.body = doc.createElement("body");
    doc.querySelectorAll = (selector) => {
        const match = /^(\w+)\[(?:data-)?([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);
        if (match === null) return [];
        const [, tag, attribute, value] = match;
        const key = attribute.replace(/-(\w)/g, (unused, char) => char.toUpperCase());
        const found = [];
        const walk = (node) => {
            if (node.tag === tag && node.dataset !== undefined && Object.prototype.hasOwnProperty.call(node.dataset, key) && (value === void 0 || node.dataset[key] === value)) found.push(node);
            for (const child of node.children) walk(child);
        };
        walk(doc.head);
        walk(doc.body);
        return found;
    };
    return doc;
}

/** Materialize the loader bundle against the shell's baseline modules. */
async function materialize(options = {}) {
    const source = await readFile(resolve(ROOT, "lib/client.js"), "utf8");
    let registered;
    const sandbox = {
        window: { __ModuleLoader__: { load: (spec) => { registered = spec.factory; } } },
        document: options.dom === false ? undefined : domSandbox(),
        // The toast mirror needs the timer surface only where waits stand.
        setTimeout,
        clearTimeout,
        queueMicrotask
    };
    vm.runInNewContext(source, sandbox, { filename: "lib/client.js" });
    const exports = registered((id) => {
        if (id === "react") return { useState: (initial) => [typeof initial === "function" ? initial() : initial, () => void 0] };
        if (id === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
        if (id === "@deepseek-ai/dsh-client-ui-primitives") return { Menu: () => ({ type: "Menu" }), Switch: () => ({ type: "Switch" }) };
        if (id === "@deepseek-ai/dsh-client-store") {
            return {
                createSnapshotStore(initial) {
                    let value = initial;
                    const listeners = new Set();
                    return {
                        subscribe(fn) {
                            listeners.add(fn);
                            return () => listeners.delete(fn);
                        },
                        getSnapshot: () => value,
                        set(next) {
                            value = next;
                            for (const fn of [...listeners]) fn();
                        }
                    };
                }
            };
        }
        throw new Error(`unknown module: ${id}`);
    });
    return { exports, sandbox };
}

/** A configuration form standing in for the shell's. */
function fakeForm(initial) {
    let snapshot = initial;
    let listeners = [];
    return {
        getSnapshot: () => snapshot,
        subscribe(fn) {
            listeners.push(fn);
            return () => {
                listeners = listeners.filter((candidate) => candidate !== fn);
            };
        },
        mutate: async () => true,
        /** Push a live answer through the subscription. */
        push(overrides) {
            snapshot = { ...snapshot, ...(overrides ?? {}), revision: snapshot.revision + 1 };
            for (const fn of [...listeners]) fn();
        }
    };
}

/** A shell context: captures the registration, answers the form. */
function fakeShell(initial = { status: "ready", value: { lastError: "" }, revision: 1, writable: true }) {
    const form = fakeForm(initial);
    const registered = [];
    let injected = false;
    const registeredLocales = [];
    const slotNames = [];
    const ctx = {
        effects: [],
        effect(setup) {
            const dispose = setup();
            ctx.effects.push(typeof dispose === "function" ? dispose : () => void 0);
        },
        locale: {
            register(namespace, dicts) {
                registeredLocales.push({ namespace, dicts });
            },
            bind() {
                return (key) => `t:${key}`;
            }
        },
        configForms: { get: () => form },
        slots: {
            inject(slotName, register) {
                injected = true;
                slotNames.push(slotName);
                register();
            },
            register(spec, Component) {
                registered.push({ spec, Component });
            }
        },
        /** Fire every effect's disposer. */
        dispose() {
            for (const dispose of [...ctx.effects].reverse()) dispose();
        }
    };
    return { ctx, registered, registeredLocales, injected: () => injected, slotNames };
}

test("registration happens once, keyed by package and entry id", async () => {
    const { exports } = await materialize();
    const shell = fakeShell();
    exports.mountSettingsCard({
        entryId: "profile-x",
        pluginId: "my-plugin",
        fields: { liveKeys: ["lastError"] },
        blocks: []
    }).apply(shell.ctx);
    const registrations = shell.registered;
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].spec.name, "plugins.row.config");
    assert.equal(registrations[0].spec.key, "my-plugin#profile-x");
    const injected = registrations[0].spec.inject();
    assert.equal(typeof injected.store, "object");
    assert.equal(typeof injected.controller, "object");
});

test("a card standing on someone else's bundle keys its page by that bundle", async () => {
    const { exports } = await materialize();
    const shell = fakeShell();
    exports.mountSettingsCard({
        entryId: "profile-x",
        pluginId: "my-plugin",
        bundleId: "my-plugin-bundle",
        blocks: []
    }).apply(shell.ctx);
    // The plugin manager reads a component row's page off `<bundle>#<row id>` —
    // the package the person installed, not the package the row runs — so
    // retagging is what makes a card reachable from the entry's Components list.
    const registrations = shell.registered;
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].spec.key, "my-plugin-bundle#profile-x");
});

test("placement bundle stands the card on the bundle's own page, keyed by the package", async () => {
    const { exports } = await materialize();
    const own = fakeShell();
    exports.mountSettingsCard({ entryId: "profile-x", pluginId: "my-plugin", placement: "bundle", blocks: [] }).apply(own.ctx);
    // The Plugins page draws `plugins.bundle.config` on the page its list opens,
    // keyed by the bundle package — no row id, no second step in.
    assert.deepEqual(own.slotNames, ["plugins.bundle.config"], "the row slot is not claimed as well");
    assert.equal(own.registered[0].spec.name, "plugins.bundle.config");
    assert.equal(own.registered[0].spec.key, "my-plugin");

    const other = fakeShell();
    exports.mountSettingsCard({ entryId: "profile-x", pluginId: "my-plugin", bundleId: "my-plugin-bundle", placement: "bundle", blocks: [] }).apply(other.ctx);
    assert.equal(other.registered[0].spec.key, "my-plugin-bundle", "a component keys the bundle the person installed");

    assert.throws(() => exports.mountSettingsCard({ entryId: "profile-x", placement: "page" }), /placement/);
    assert.throws(() => exports.mountSettingsCard({ entryId: "profile-x", placement: "bundle", blocks: [] }).apply(fakeShell().ctx), /pluginId/);
});

test("the page shape renders the declared blocks; the summary renders the hook", async () => {
    const { exports } = await materialize();
    const shell = fakeShell();
    const seenViews = [];
    exports.mountSettingsCard({
        entryId: "profile-x",
        pluginId: "my-plugin",
        blocks: [{ block: "FlagsBlock", field: "extraFlags", action: "stage", props: { title: "Flags" }, hideWhenUnavailable: false }],
        renderSummary: (snapshot) => "summary:" + String(snapshot.available)
    }).apply(shell.ctx);

    const Body = shell.registered[0].Component;
    seenViews.push(Body({ view: "summary" }));
    const page = Body({ view: "page" });
    assert.equal(seenViews[0], "summary:true");
    assert.ok(Array.isArray(page));
    assert.equal(page.length, 1);
});

test("the summary is handed the same copy door the page carries", async () => {
    const { exports } = await materialize();
    const shell = fakeShell();
    exports.mountSettingsCard({
        entryId: "profile-x",
        pluginId: "my-plugin",
        blocks: [],
        renderSummary: (_snapshot, t) => {
            assert.equal(typeof t, "function", "the rule: a second argument hands the copy");
            return `${t("connectionsRunning")}/${t("connectionsTotal")}`;
        }
    }).apply(shell.ctx);

    const Body = shell.registered[0].Component;
    assert.equal(Body({ view: "summary" }), "t:connectionsRunning/t:connectionsTotal");
});

test("the body carries the one error line and nothing else", async () => {
    const { exports } = await materialize();    const shell = fakeShell({ status: "ready", value: { lastError: "bridge failed to start" }, revision: 1, writable: true });
    exports.mountSettingsCard({ entryId: "profile-x", pluginId: "my-plugin", blocks: [] }).apply(shell.ctx);
    const Body = shell.registered[0].Component;
    const body = Body({ view: "page" });
    const texts = JSON.stringify(body);
    assert.match(texts, /bridge failed to start/);
    assert.match(texts, /role/);
    assert.match(texts, /status/);
});

test("a card whose blocks state the error themselves can turn the body's own line off", async () => {
    const { exports } = await materialize();
    const shell = fakeShell({ status: "ready", value: { lastError: "bridge failed to start" }, revision: 1, writable: true });
    exports.mountSettingsCard({ entryId: "profile-x", pluginId: "my-plugin", errorLine: false, blocks: [{ block: () => "own body" }] }).apply(shell.ctx);
    const Body = shell.registered[0].Component;
    assert.deepEqual(Body({ view: "page" }), ["own body"], "only the blocks — no second error line");
});

test("a card that can read nothing registers and renders nothing", async () => {
    const { exports } = await materialize();
    const shell = fakeShell({ status: "unavailable" });
    exports.mountSettingsCard({
        entryId: "profile-x",
        pluginId: "my-plugin",
        blocks: [{ block: "FlagsBlock", field: "extraFlags", action: "stage", props: { title: "Flags" }, hideWhenUnavailable: true }]
    }).apply(shell.ctx);
    const Body = shell.registered[0].Component;
    const body = Body({ view: "page" });
    assert.deepEqual(body, []);
});

test("the descriptor composes actions onto its blocks", async () => {
    const { exports } = await materialize();
    const shell = fakeShell();
    let composedAction;
    exports.mountSettingsCard({
        entryId: "profile-x",
        pluginId: "my-plugin",
        blocks: [{ block: (props) => { composedAction = props.action; return props.field; }, field: "extraFlags", action: "write" }]
    }).apply(shell.ctx);
    const Body = shell.registered[0].Component;
    assert.deepEqual(Body({ view: "page" }), ["extraFlags"]);
    assert.equal(typeof composedAction, "function");
});

/* ── huecos: `t` en bind, `toasts`, no-intrusión ──────────────────────── */

test("bind answers with the copy door as its third argument", async () => {
    const { exports } = await materialize();
    const shell = fakeShell();
    let answered = void 0;
    exports.mountSettingsCard({
        entryId: "profile-x",
        pluginId: "my-plugin",
        blocks: [{
            block: () => null,
            bind: (snapshot, controller, t) => {
                answered = t("probe");
                return {};
            }
        }]
    }).apply(shell.ctx);
    const Body = shell.registered[0].Component;
    Body({ view: "page" });
    assert.equal(answered, "t:probe");
});

test("a card mounts nowhere else: the row-config slot is the only surface it touches", async () => {
    const { exports, sandbox } = await materialize();
    const shell = fakeShell();
    exports.mountSettingsCard({ entryId: "profile-x", pluginId: "my-plugin", blocks: [] }).apply(shell.ctx);
    exports.mountSettingsCard({ entryId: "profile-x", pluginId: "my-plugin", blocks: [] }).apply(shell.ctx);
    assert.deepEqual(shell.slotNames, ["plugins.row.config", "plugins.row.config"]);
    // Nothing reaches the page behind the registration: without the declared
    // toast host there is no DOM of the card's own.
    assert.equal(sandbox.document.body.children.length, 0);
});

test("the toasts hole stands one root per page and mirrors what the controller stages", async () => {
    const { exports, sandbox } = await materialize();
    const one = fakeShell();
    exports.mountSettingsCard({ entryId: "profile-x", pluginId: "p-one", toasts: true, blocks: [] }).apply(one.ctx);
    const two = fakeShell();
    exports.mountSettingsCard({ entryId: "profile-y", pluginId: "p-two", toasts: true, blocks: [] }).apply(two.ctx);
    // One root per page, however many cards asked.
    const roots = sandbox.document.querySelectorAll("div[data-dsh-ancesters-toasts]");
    assert.equal(roots.length, 1);
    // Staging a notice at one card draws its node under the standing root…
    const controller = one.registered[0].spec.inject().controller;
    controller.noteNotice("error", "connection refused");
    assert.equal(roots[0].children.length, 1);
    const toast = roots[0].children[0];
    assert.equal(toast.dataset.noticeKind, "error");
    // The mirror's DOM is classed, not merely attributed: the shared sheet is
    // what positions the notices and reads the kind off the node.
    assert.ok(String(toast.className).length > 0, "the toast node carries the sheet's class");
    assert.ok(String(roots[0].className).length > 0, "the toast root carries the sheet's class");
    assert.equal(toast.textContent, "connection refused");
    // …and the clear is what removes it — no timer involved.
    controller.clearNotice(controller.getSnapshot().notice.seq);
    assert.equal(roots[0].children.length, 0);
});

test("a stall reads the card's copy, and a notice dismisses itself or on a click", async () => {
    const { exports, sandbox } = await materialize();
    const shell = fakeShell();
    const host = sandbox.document.createElement("div");
    exports.mountSettingsCard({ entryId: "profile-x", pluginId: "my-plugin", toasts: { host, dismissMs: 5 }, blocks: [] }).apply(shell.ctx);
    const controller = shell.registered[0].spec.inject().controller;
    // A stall carries no Host line: it reads the copy (the shell stub's `t`
    // answers `t:<key>`).
    controller.noteNotice("stall", "");
    assert.equal(host.children[0].textContent, "t:toastStall");
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(host.children.length, 0, "it dismissed itself through the controller");
    assert.equal(controller.getSnapshot().notice, null);
    // A failure with no line of its own reads the error copy; a click clears it.
    controller.noteNotice("error", "");
    assert.equal(host.children[0].textContent, "t:toastError");
    host.children[0].onclick();
    assert.equal(host.children.length, 0, "a click dismisses it");
    shell.ctx.dispose();
});

test("a consumer's own reading of a notice answers over the shared rule", async () => {
    const { exports, sandbox } = await materialize();
    const shell = fakeShell();
    const host = sandbox.document.createElement("div");
    exports.mountSettingsCard({
        entryId: "profile-x",
        pluginId: "my-plugin",
        toasts: { host, dismissMs: 0, text: (notice, snapshot, t) => (notice.kind === "stall" && snapshot.lastError !== "" ? snapshot.lastError : t(notice.kind)) },
        blocks: []
    }).apply(shell.ctx);
    const controller = shell.registered[0].spec.inject().controller;
    controller.noteNotice("stall", "");
    assert.equal(host.children[0].textContent, "t:stall", "the consumer's hook answered");
    shell.ctx.dispose();
});

test("the host form renders inside the caller's element and leaves when the effect does", async () => {
    const { exports, sandbox } = await materialize();
    const shell = fakeShell();
    const host = sandbox.document.createElement("div");
    exports.mountSettingsCard({ entryId: "profile-x", pluginId: "my-plugin", toasts: { host }, blocks: [] }).apply(shell.ctx);
    const controller = shell.registered[0].spec.inject().controller;
    controller.noteNotice("stall", "run did not answer");
    assert.equal(host.children.length, 1);
    assert.equal(host.children[0].dataset.noticeKind, "stall");
    shell.ctx.dispose();
    assert.equal(host.children.length, 0);
});

test("the notices are drawn in the document the host stands in, not the loader's", async () => {
    const { exports } = await materialize();
    const shell = fakeShell();
    const host = domNode("div");
    let drawn = 0;
    host.ownerDocument = {
        createElement: (tag) => {
            drawn++;
            return domNode(tag);
        }
    };
    exports.mountSettingsCard({ entryId: "profile-x", pluginId: "my-plugin", toasts: { host }, blocks: [] }).apply(shell.ctx);
    const controller = shell.registered[0].spec.inject().controller;
    controller.noteNotice("error", "refused in another document");
    assert.equal(drawn, 1, "the node is created by the document the card lives in");
    assert.equal(host.children[0].textContent, "refused in another document");
    shell.ctx.dispose();
});

test("without a DOM the toasts mirror draws nothing and stages everything", async () => {
    const { exports } = await materialize({ dom: false });
    const shell = fakeShell();
    exports.mountSettingsCard({ entryId: "profile-x", pluginId: "my-plugin", toasts: true, blocks: [] }).apply(shell.ctx);
    const controller = shell.registered[0].spec.inject().controller;
    controller.noteNotice("error", "boom");
    assert.equal(controller.getSnapshot().notice.kind, "error");
});

test("the composer hole registers once in the input row, keyed by its id, off the card's own store", async () => {
    const { exports } = await materialize();
    const shell = fakeShell();
    let picked = null;
    exports.mountSettingsCard({
        entryId: "profile-x",
        pluginId: "my-plugin",
        fields: { liveKeys: ["lastError"] },
        blocks: [],
        composer: {
            id: "my-plugin#pill",
            bind: (snapshot, _controller, t) => [
                { key: "profile", label: "default", title: t("pickTitle"), options: [{ id: "default", label: "default" }, { id: "dev", label: "dev" }], selectedId: "default", onSelect: (id) => { picked = id; } }
            ]
        }
    }).apply(shell.ctx);
    assert.deepEqual(shell.slotNames, ["plugins.row.config", "conversation.input.left"]);
    const pill = shell.registered.find((entry) => entry.spec.name === "conversation.input.left");
    assert.equal(pill.spec.id, "my-plugin#pill", "a list slot places entries by a stable id");
    assert.equal(pill.spec.key, undefined);
    const injected = pill.spec.inject();
    assert.equal(typeof injected.hooks.ancestersComposer.getSnapshot, "function", "the pill subscribes to the card's own store");

    const drawn = pill.Component({ t: (key) => `t:${key}` });
    assert.equal(drawn.type, "span");
    assert.equal(drawn.props.children.length, 1);
    const one = drawn.props.children[0];
    assert.equal(one.props.key, "profile");
    assert.equal(one.props.label, "default");
    assert.equal(one.props.title, "t:pickTitle", "the pill gets the copy door");
    assert.equal(one.props.open, false);
    one.props.onSelect("dev");
    assert.equal(picked, "dev");
});

test("a composer that binds no pill draws nothing, and a card without one claims no input slot", async () => {
    const { exports } = await materialize();
    const shell = fakeShell();
    exports.mountSettingsCard({
        entryId: "profile-x",
        pluginId: "my-plugin",
        fields: { liveKeys: ["lastError"] },
        blocks: [],
        composer: { id: "my-plugin#pill", bind: () => [] }
    }).apply(shell.ctx);
    const pill = shell.registered.find((entry) => entry.spec.name === "conversation.input.left");
    assert.equal(pill.Component({}), null);

    const plain = fakeShell();
    exports.mountSettingsCard({ entryId: "profile-x", pluginId: "my-plugin", fields: { liveKeys: [] }, blocks: [] }).apply(plain.ctx);
    assert.deepEqual(plain.slotNames, ["plugins.row.config"], "no-intrusion: only the slots the descriptor declares");
});
