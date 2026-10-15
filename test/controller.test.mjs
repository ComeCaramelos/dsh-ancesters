/**
 * The card controller — store projection, staged vs immediate writes, the
 * write-budget passes, the settle, and a clean dispose.
 *
 * Runs against the emitted client bundle (same materialization as the loader
 * test), so it exercises the real class, not a source mirror.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Stand the loader bundle up against the shell's baseline modules. */
async function materialize() {
    const source = await readFile(resolve(ROOT, "lib/client.js"), "utf8");
    let registered;
    const sandbox = {
        window: { __ModuleLoader__: { load: (spec) => { registered = spec.factory; } } },
        document: undefined,
        // The wait owns wall-clock timers: the sandbox hands exactly these.
        setTimeout,
        clearTimeout
    };
    vm.runInNewContext(source, sandbox, { filename: "lib/client.js" });
    const exports = registered((id) => {
        if (id === "react") return { useState: (initial) => [typeof initial === "function" ? initial() : initial, () => void 0] };
        if (id === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
        if (id === "@deepseek-ai/dsh-client-ui-primitives") return { Menu: () => null, Switch: () => null };
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
    return exports;
}

/** A ready configuration form with a recording write door. */
function fakeForm(overrides = {}) {
    let snapshot = { status: "ready", value: { lastError: "", extraFlags: [], executables: [] }, revision: 1, writable: true };
    const mutates = [];
    let listeners = [];
    return {
        mutates,
        getSnapshot: () => snapshot,
        subscribe(fn) {
            listeners.push(fn);
            return () => {
                listeners = listeners.filter((candidate) => candidate !== fn);
            };
        },
        mutate: overrides.mutate ?? (async (ops, revision) => {
            mutates.push({ ops, revision });
            snapshot = { ...snapshot, revision: snapshot.revision + 1 };
            for (const fn of [...listeners]) fn();
            return true;
        }),
        /** Push a live answer through the subscription. */
        push(overrides2) {
            snapshot = { ...snapshot, ...(overrides2 ?? {}), revision: snapshot.revision + 1 };
            for (const fn of [...listeners]) fn();
        },
        rejectNext: overrides.reject === true
    };
}

test("a ready form answers available with its values, a loading form answers nothing", async () => {
    const exports = await materialize();
    const controller = new exports.CardController(fakeForm({}));
    assert.equal(controller.getSnapshot().available, true);
    assert.equal(controller.getSnapshot().writable, true);
    controller.dispose();

    const none = new exports.CardController(undefined);
    assert.equal(none.getSnapshot().available, false);
    none.dispose();
});

test("staged edits: dirty only on a diff, applied through one op per field", async () => {
    const exports = await materialize();
    const form = fakeForm();
    const controller = new exports.CardController(form);
    // A draft equal to what is served is not dirty.
    controller.stage("extraFlags", []);
    assert.equal(controller.getSnapshot().dirty, false);

    controller.stage("extraFlags", ["--x"]);
    assert.equal(controller.getSnapshot().dirty, true);
    assert.deepEqual(controller.getSnapshot().values.extraFlags, ["--x"]);

    assert.equal(await controller.applyStaged(), true);
    assert.equal(controller.getSnapshot().dirty, false);
    assert.equal(form.mutates.length, 1);
    assert.equal(JSON.stringify(form.mutates[0].ops), JSON.stringify([{ op: "set", path: ["extraFlags"], value: ["--x"] }]));
    controller.dispose();
});

test("discard drops drafts without touching the Host", async () => {
    const exports = await materialize();
    const form = fakeForm();
    const controller = new exports.CardController(form);
    controller.stage("extraFlags", ["--x"]);
    controller.discard();
    assert.equal(controller.getSnapshot().dirty, false);
    assert.equal(form.mutates.length, 0);
    controller.dispose();
});

test("a refused write stands the draft with `failed`; the budget re-issues before it gives up", async () => {
    const exports = await materialize();
    let passes = 0;
    const form = fakeForm({
        mutate: async () => {
            passes++;
            return false;
        }
    });
    const controller = new exports.CardController(form);
    controller.stage("extraFlags", ["--x"]);
    assert.equal(await controller.applyStaged(), false);
    assert.equal(passes, exports.MAX_WRITE_PASSES, "one re-issue per pass against the re-read document");
    assert.equal(controller.getSnapshot().dirty, true);
    assert.equal(controller.getSnapshot().failed, true);
    controller.dispose();
});

test("the served value reads without the draft over it", async () => {
    const exports = await materialize();
    const form = fakeForm();
    const controller = new exports.CardController(form, { fields: { staged: ["extraFlags"] } });
    controller.stage("extraFlags", ["--x"]);
    assert.deepEqual(controller.value("extraFlags"), ["--x"], "the snapshot carries the draft");
    assert.deepEqual(controller.servedValue("extraFlags"), [], "the served value does not");
    controller.dispose();
});

test("an immediate write can settle on the Host run behind it (`settleAndWrite`)", async () => {
    const exports = await materialize();
    const form = fakeForm();
    const controller = new exports.CardController(form, { fields: { immediate: ["chromePath"] }, settleDeadlineMs: 5000 });
    let settled = false;
    const run = controller
        .settleAndWrite((snapshot) => Number(snapshot.values.runRevision ?? 0) > 0, "chromePath", "/opt/chrome")
        .then(() => {
            settled = true;
        });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(JSON.stringify(form.mutates[0].ops[0]), JSON.stringify({ op: "set", path: ["chromePath"], value: "/opt/chrome" }), "the field is written on the spot");
    assert.equal(settled, false, "and the wait stands until the run answers");
    form.push({ value: { ...form.getSnapshot().value, runRevision: 1 } });
    await run;
    assert.equal(settled, true, "settled by the run's own answer");
    controller.dispose();
});

test("every write clears the live-mirror keys, so a save never persists what the Host answers", async () => {
    const exports = await materialize();
    const form = fakeForm();
    const controller = new exports.CardController(form, { fields: { immediate: ["servers"], liveKeys: ["live", "kinds", "servers"] } });
    assert.equal(await controller.writeField("servers", [{ id: "a" }]), true);
    assert.equal(
        JSON.stringify(form.mutates[0].ops),
        JSON.stringify([
            { op: "set", path: ["servers"], value: [{ id: "a" }] },
            { op: "unset", path: ["live"] },
            { op: "unset", path: ["kinds"] }
        ]),
        "the written field is never cleared, every other live key is"
    );
    controller.dispose();
});

test("a host that keeps moving the revision cannot starve a write: the last pass goes out unfenced", async () => {
    const exports = await materialize();
    let fenced = 0;
    const unfenced = [];
    const form = fakeForm({
        mutate: async () => {
            fenced++;
            return false;
        }
    });
    const controller = new exports.CardController(form, {
        unfencedMutate: async (ops) => {
            unfenced.push(ops);
            return true;
        }
    });
    controller.stage("extraFlags", ["--x"]);
    assert.equal(await controller.applyStaged(), true, "the write lands");
    assert.equal(fenced, exports.MAX_WRITE_PASSES - 1, "every pass but the last is fenced");
    assert.equal(unfenced.length, 1, "the last one carries no fence");
    assert.equal(JSON.stringify(unfenced[0]), JSON.stringify([{ op: "set", path: ["extraFlags"], value: ["--x"] }]), "composed like any other pass");
    assert.equal(controller.getSnapshot().failed, false);
    controller.dispose();
});

test("an accepted live commit never fences ahead of itself: a write issued during churn still lands", async () => {
    const exports = await materialize();
    let revision = 1;
    const accepted = [];
    const form = fakeForm();
    form.mutate = async (ops, fence) => {
        accepted.push(fence);
        revision++;
        form.push({ revision });
        return true;
    };
    const controller = new exports.CardController(form);
    assert.equal(await controller.writeField("chromePath", "/x"), true);
    assert.equal(accepted.length >= 1, true, "the write crossed the door once at least");
    // No pass carries a revision this side read: the form fences on what it
    // mirrors, which is never behind the Host's last folded answer.
    assert.equal(accepted.every((fence) => fence === undefined), true, "no card-side fence");
    controller.dispose();
});

test("a refused write's error line stands until the Host answers again", async () => {
    const exports = await materialize();
    const form = fakeForm({ mutate: async () => false });
    const controller = new exports.CardController(form, { fields: { staged: ["extraFlags"] } });
    controller.stage("extraFlags", ["--x"]);
    assert.equal(await controller.applyStaged(), false);
    assert.equal(controller.getSnapshot().actionError, "configuration write refused", "the refusal is stated");
    form.push({});
    assert.equal(controller.getSnapshot().actionError, "", "the next served answer replaces it");
    controller.dispose();
});

test("an adopted page form is the write door, never the source: reads stay on the shared mirror", async () => {
    const exports = await materialize();
    const form = fakeForm();
    const controller = new exports.CardController(form, { fields: { immediate: ["chromePath"] } });
    const pageWrites = [];
    // The page hands a snapshot taken when it rendered — already behind.
    const page = { state: { status: "ready", value: { chromePath: "stale" }, revision: 1, writable: true }, mutate: async (ops) => (pageWrites.push(ops), true) };
    controller.adoptForm(page);
    form.push({ value: { ...form.getSnapshot().value, chromePath: "live" } });
    assert.equal(controller.value("chromePath"), "live", "the card reads what the shared form mirrors");
    assert.equal(await controller.writeField("chromePath", "/x"), true);
    assert.equal(pageWrites.length, 1, "the write took the page's door");
    assert.equal(form.mutates.length, 0, "and not the shared form's");
    controller.dispose();
});

test("the door is called as a method of its form, never detached", async () => {
    const exports = await materialize();
    const form = fakeForm();
    const real = form.mutate;
    form.mutate = function (ops, fence) {
        if (this !== form) throw new Error("called bare");
        return real(ops, fence);
    };
    const controller = new exports.CardController(form);
    assert.equal(await controller.writeField("chromePath", "/x"), true, "the shared form's door keeps its `this`");
    const page = { state: form.getSnapshot(), mutate(ops) { if (this !== page) throw new Error("called bare"); return Promise.resolve(true); } };
    controller.adoptForm(page);
    assert.equal(await controller.writeField("chromePath", "/y"), true, "and so does the page's");
    controller.dispose();
});

test("the live mirror never lands as staged", async () => {
    const exports = await materialize();
    const form = fakeForm();
    const controller = new exports.CardController(form, { fields: { liveKeys: ["lastError"] } });
    form.push({ value: { lastError: "boom" } });
    assert.equal(controller.getSnapshot().lastError, "boom");
    assert.equal(controller.getSnapshot().dirty, false);
    controller.dispose();
});

test("dispose releases subscriptions and late pushes do not re-enter the store", async () => {
    const exports = await materialize();
    const form = fakeForm();
    const controller = new exports.CardController(form);
    controller.dispose();
    form.push({ value: { lastError: "late" } });
    assert.equal(controller.getSnapshot().lastError, "");
});

test("the settle waits on an armed predicate — no polling, the push settles it", async () => {
    const exports = await materialize();
    const form = fakeForm();
    const controller = new exports.CardController(form, { settleDeadlineMs: 5000 });
    const wait = controller.settleOn((snapshot) => snapshot.values.runAnswered === true);
    setTimeout(() => form.push({ value: { lastError: "", runAnswered: true } }), 1);
    await wait.settle;
    assert.equal(controller.getSnapshot().values.runAnswered, true);
    controller.dispose();
});

test("a deadline that fires without the predicate stages one stall notice", async () => {
    const exports = await materialize();
    const form = fakeForm();
    const controller = new exports.CardController(form, { settleDeadlineMs: 5 });
    await new Promise((resolve) => {
        controller.settleAndTrigger(() => false, "refreshNonce").then(resolve);
    });
    // The trigger write lands (the form accepts), then the mirror never answers.
    assert.equal(controller.getSnapshot().notice?.kind, "stall");
    controller.clearNotice(controller.getSnapshot().notice.seq);
    assert.equal(controller.getSnapshot().notice, null);
    controller.dispose();
});

test("an immediate write trigger stamps a diff value and routes through the door", async () => {
    const exports = await materialize();
    const form = fakeForm();
    const controller = new exports.CardController(form);
    const before = Date.now();
    assert.equal(await controller.writeTrigger("refreshNonce"), true);
    assert.ok(form.mutates[0].ops[0].value >= before);
    controller.dispose();
});

/* ── huecos entryActions / settleField ─────────────────────────────────── */

/** A form that folds accepted ops into its served values. */
function foldingForm(initial = {}) {
    let values = { ...initial };
    let revision = 1;
    let listeners = [];
    return {
        mutates: [],
        getSnapshot: () => ({ status: "ready", value: { ...values }, revision, writable: true }),
        subscribe(fn) {
            listeners.push(fn);
            return () => {
                listeners = listeners.filter((candidate) => candidate !== fn);
            };
        },
        async mutate(ops) {
            this.mutates.push({ ops, revision });
            for (const op of ops) values = { ...values, [op.path[0]]: op.value };
            revision++;
            for (const fn of [...listeners]) fn();
            return true;
        },
        push(overrides) {
            values = { ...values, ...(overrides ?? {}) };
            revision++;
            for (const fn of [...listeners]) fn();
        }
    };
}

test("an entry trigger stamps its key inside the map, keeping every other row", async () => {
    const exports = await materialize();
    const form = foldingForm({ refreshNonce: { "0": 111 } });
    const controller = new exports.CardController(form);
    assert.equal(await controller.writeEntryTrigger("refreshNonce", 1), true);
    const written = form.mutates[0].ops[0].value;
    assert.equal(written["0"], 111, "a standing row keeps its stamp");
    assert.ok(written["1"] >= 1);
    // A second entry trigger against the live map: still every key.
    assert.equal(await controller.writeEntryTrigger("refreshNonce", 2), true);
    const second = form.mutates[1].ops[0].value;
    assert.deepEqual(Object.keys(second).sort(), ["0", "1", "2"]);
    controller.dispose();
});

test("an entry trigger on an absent map starts one (first row)", async () => {
    const exports = await materialize();
    const form = foldingForm({});
    const controller = new exports.CardController(form);
    assert.equal(await controller.writeEntryTrigger("refreshNonce", 0), true);
    assert.deepEqual(Object.keys(form.mutates[0].ops[0].value), ["0"]);
    controller.dispose();
});

test("the keyed wait answers for its entry — the diff, not the whole mirror", async () => {
    const exports = await materialize();
    const form = foldingForm({ refreshNonce: {}, live: {} });
    const controller = new exports.CardController(form, { settleDeadlineMs: 5000, settleField: "live" });
    const wait = controller.settleEntryTrigger("refreshNonce", 1);
    // Give the write a turn to cross the door: the map stamps row 1, the
    // answer the Host runs for moves nothing yet.
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(form.mutates.length >= 1, "the entry nonce crossed the door");
    // …then the run answers what row 1 stands for: that diff settles the wait.
    form.push({ live: { "1": "done" } });
    await wait;
    controller.dispose();
});

test("two entry triggers in one turn keep both stamps — the merge is the document's, not the last render's", async () => {
    const exports = await materialize();
    const form = foldingForm({ refreshNonce: {} });
    const controller = new exports.CardController(form);
    // No `await` between them: the second row's write must not answer with what
    // this half happened to render before the first one landed.
    await Promise.all([controller.writeEntryTrigger("refreshNonce", "one"), controller.writeEntryTrigger("refreshNonce", "two")]);
    const written = form.mutates[form.mutates.length - 1].ops[0].value;
    assert.deepEqual(Object.keys(written).sort(), ["one", "two"], "one row's action never erases another's");
    controller.dispose();
});

test("a re-stamp standing inside the same millisecond still answers a diff", async () => {
    const exports = await materialize();
    // The field already stands at `Date.now()`: a stamp that is only `Date.now()`
    // would answer no change at all, and nothing would ever launch.
    const standing = Date.now();
    const form = foldingForm({ refreshNonce: standing });
    const controller = new exports.CardController(form);
    assert.equal(await controller.writeTrigger("refreshNonce"), true);
    assert.ok(form.mutates[0].ops[0].value > standing, "the stamp moved off what stood");

    const keyed = foldingForm({ refreshNonce: { "0": standing } });
    const keyedController = new exports.CardController(keyed);
    assert.equal(await keyedController.writeEntryTrigger("refreshNonce", "0"), true);
    assert.ok(keyed.mutates[0].ops[0].value["0"] > standing, "the keyed stamp moved too");
    keyedController.dispose();
    controller.dispose();
});

test("a keyed wait over a list mirror answers for its own row only", async () => {
    const exports = await materialize();
    // The live mirror a card actually carries: one line per key, in a list.
    const form = foldingForm({
        nonce: {},
        live: [{ id: "one", state: "connected" }, { id: "two", state: "connected" }]
    });
    const controller = new exports.CardController(form, { settleDeadlineMs: 5000, settleField: "live" });
    let answered = false;
    const wait = controller.settleEntryTrigger("nonce", "two").then(() => { answered = true; });
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Row `one` moving is not row `two`'s answer.
    form.push({ live: [{ id: "one", state: "failed" }, { id: "two", state: "connected" }] });
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(answered, false, "another row's move must not settle this wait");

    form.push({ live: [{ id: "one", state: "failed" }, { id: "two", state: "connected", note: "4 tools" }] });
    await wait;
    assert.equal(answered, true);
    controller.dispose();
});

test("a settleField that never moves reports the stall — the wall clock stays the backstop", async () => {
    const exports = await materialize();
    const form = fakeForm();
    const controller = new exports.CardController(form, { settleDeadlineMs: 15, settleField: "watch" });
    await controller.settleTrigger("nonce");
    assert.equal(controller.getSnapshot().notice?.kind, "stall");
    controller.clearNotice(controller.getSnapshot().notice.seq);
    controller.dispose();
});

test("the settleField wait settles off a diff, not a publish", async () => {
    const exports = await materialize();
    const form = foldingForm({ watch: 1, nonce: 0 });
    const controller = new exports.CardController(form, { settleDeadlineMs: 5000, settleField: "watch" });
    const wait = controller.settleTrigger("nonce");
    // The write moves `nonce`, not `watch`: still waiting…
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(form.mutates.length, 1);
    // …and the host run moves what the settle watches: done.
    form.push({ watch: 2 });
    await wait;
    controller.dispose();
});

test("overridden lists exactly the fields the user layer carries", async () => {
    const exports = await materialize();
    const form = fakeForm();
    const controller = new exports.CardController(form, { fields: { immediate: ["title", "url"] } });
    assert.deepEqual([...controller.getSnapshot().overridden], [], "a form serving no user layer overrides nothing");
    form.push({ value: { title: "a", url: "b" }, user: { title: "a" } });
    assert.deepEqual([...controller.getSnapshot().overridden], ["title"]);
    controller.dispose();
});

test("resetField unsets one field through the write door and drops its draft", async () => {
    const exports = await materialize();
    const form = fakeForm();
    const controller = new exports.CardController(form, { fields: { staged: ["title"] } });
    controller.stage("title", "draft");
    assert.equal(controller.getSnapshot().dirty, true);
    assert.equal(await controller.resetField("title"), true);
    assert.deepEqual(JSON.parse(JSON.stringify(form.mutates.at(-1).ops)), [{ op: "unset", path: ["title"] }]);
    assert.equal(controller.getSnapshot().dirty, false, "the draft over the reset field leaves with it");
    controller.dispose();
});
