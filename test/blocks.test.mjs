/**
 * Blocks render test.
 *
 * The blocks compile into `lib/blocks.js`; here that bundle stands up in a
 * `node:vm` against stub `react` / `react/jsx-runtime` / shell primitives —
 * two consumers, same widgets — the way every reference checkout tests its
 * card, minus the GUI. A block whose shape drifts fails here; a block that
 * reaches for a dsh surface fails in `surface.test.mjs`.
 */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STUB_SHEET = "dshAncesters_stub_sheet";

/**
 * Stand `lib/blocks.js` up against stub modules and return its exports.
 */
async function blocks() {
    const result = await build({
        entryPoints: [resolve(ROOT, "lib/blocks.js")],
        bundle: true,
        format: "cjs",
        platform: "neutral",
        write: false,
        logLevel: "silent",
        plugins: [{
            name: "stub-modules",
            setup(api) {
                api.onResolve({ filter: /^react(\/jsx-runtime)?$/ }, (args) => ({ path: args.path, namespace: "stub" }));
                api.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({ path: "primitives", namespace: "stub" }));
                api.onLoad({ filter: /.*/, namespace: "stub" }, (args) => {
                    if (args.path === "react") {
                        return { contents: `
                            // Stateless unless a test installs a hook store
                            // (\`__setHooks\`): then each call takes the next slot.
                            export function useState(initial) {
                                var value = typeof initial === "function" ? initial() : initial;
                                var hooks = globalThis.__hooks;
                                if (!hooks) return [value, function () {}];
                                var at = hooks.index++;
                                if (!(at in hooks.slots)) hooks.slots[at] = value;
                                return [hooks.slots[at], function (next) {
                                    hooks.slots[at] = typeof next === "function" ? next(hooks.slots[at]) : next;
                                }];
                            }
                            export var jsx = undefined;
                        `, loader: "js" };
                    }
                    if (args.path === "react/jsx-runtime") {
                        return { contents: `
                            export function jsx(type, props, key) {
                                var node = { type: type, props: props || {}, children: (props && props.children !== undefined ? [props.children] : []) };
                                if (key !== undefined) node.key = key;
                                return node;
                            }
                            export function jsxs(type, props, key) { return jsx(type, props, key); }
                            export function Fragment(props) { return props.children; }
                        `, loader: "js" };
                    }
                    return { contents: `
                        export function Menu(props) { return { type: "Menu", props: props }; }
                        export function Switch(props) { return { type: "Switch", props: props }; }
                    `, loader: "js" };
                });
            }
        }]
    });
    const source = result.outputFiles[0].text;
    const sandbox = {
        module: { exports: {} },
        exports: undefined,
        require: () => {
            throw new Error("unexpected require");
        }
    };
    vm.runInNewContext(source, sandbox, { filename: "lib/blocks.js" });
    return Object.assign({}, sandbox.module.exports, {
        /** Give `useState` real slots (`{ slots, index }`; reset `index` per render). */
        __setHooks: (hooks) => {
            sandbox.__hooks = hooks;
        }
    });
}

/**
 * Depth-first walk collecting nodes where `pred` answers true, rendering any
 * component it meets along the way (a "Menu" component is not in the tree
 * until rendered).
 */
function collect(node, pred, out = [], seen = 0) {
    if (node === null || node === undefined || typeof node !== "object" || seen > 400) return out;
    if (Array.isArray(node)) {
        for (const item of node) collect(item, pred, out, seen);
        return out;
    }
    if (typeof node.type === "function") {
        return collect(node.type(node.props), pred, out, seen + 1);
    }
    if (pred(node)) out.push(node);
    collect(node.children, pred, out, seen);
    return out;
}

/** One leaf value inside a node tree. */
const is = (type) => (node) => node.type === type;

test("RowsBlock renders one row box per served row and the add control", async () => {
    const { RowsBlock } = await blocks();
    const tree = RowsBlock({
        values: [["/one", "One"], ["/two", "Two"]],
        save: () => Promise.resolve(),
        labels: ["Path", "Name"],
        writable: true,
        addLabel: "Add"
    });
    const inputs = collect(tree, is("input"));
    assert.equal(inputs.length, 4, "two rows × two columns");
    assert.equal(inputs[0].props.value, "/one");
    const buttons = collect(tree, is("button"));
    // add + one delete per row.
    assert.equal(buttons.length, 3);
});

test("RowsBlock keeps drawing the served rows when a second commit writes the same list", async () => {
    const { RowsBlock, __setHooks } = await blocks();
    const hooks = { slots: {}, index: 0 };
    __setHooks(hooks);
    let served = [];
    const render = () => {
        hooks.index = 0;
        return RowsBlock({
            values: served.map((flag) => [flag]),
            save: (rows) => {
                served = rows.map((row) => row[0]);
            },
            labels: ["Flag"],
            writable: true,
            addLabel: "Add"
        });
    };
    const settle = () => new Promise((done) => setImmediate(done));
    const input = () => collect(render(), is("input"))[0];

    collect(render(), is("button")).find((button) => button.props.children === "Add").props.onClick();
    input().props.onChange({ target: { value: "--headless" } });
    // Enter commits, and the blur that follows commits the very same list.
    input().props.onKeyDown({ key: "Enter" });
    await settle();
    input().props.onBlur();
    await settle();
    assert.deepEqual(Array.from(served), ["--headless"]);
    assert.deepEqual(collect(render(), is("input")).map((node) => node.props.value), ["--headless"], "the served row stays drawn");
});

test("RowsBlock renders nothing as empty text, and the add control is inert when not writable", async () => {
    const { RowsBlock } = await blocks();
    const tree = RowsBlock({ values: [], save: () => Promise.resolve(), labels: ["Flag"], emptyLabel: "None yet", writable: false });
    assert.ok(collect(tree, (node) => node.props && node.props.children === "None yet").length === 1);
    for (const button of collect(tree, is("button"))) {
        assert.equal(button.props.disabled, true, `${String(button.props.children ?? "")} must be inert`);
    }
});

test("PickerBlock renders the saved rows through RowsBlock plus its refresh trigger", async () => {
    const { PickerBlock } = await blocks();
    let refreshed = 0;
    const tree = PickerBlock({
        entries: [{ id: "/x", name: "X" }, { id: "/y", name: "" }],
        options: [{ id: "/x", label: "X" }],
        selectedId: "/x",
        selectedLabel: "X",
        menuOpen: false,
        setMenuOpen: () => {},
        select: () => {},
        refresh: () => { refreshed++; },
        refreshLabel: "Refresh",
        writable: true,
        save: () => Promise.resolve()
    });
    const inputs = collect(tree, is("input"));
    assert.equal(inputs.length, 4, "two saved rows × id + name");
    const menu = collect(tree, (node) => node.type === "Menu");
    assert.equal(menu.length, 1);
    const buttons = collect(tree, is("button"));
    assert.ok(buttons.some((button) => button.props.children === "Refresh"));
    assert.equal(refreshed, 0);
});

test("FlagsBlock renders one column per flag and the action line the consumer adds", async () => {
    const { FlagsBlock } = await blocks();
    let written = null;
    const tree = FlagsBlock({
        flags: ["--a", "--b"],
        save: (next) => { written = next; return Promise.resolve(); },
        title: "Extra flags",
        hint: "Passed to the server",
        actions: [{ label: "Append", merged: (current) => [...current, "--extra"] }],
        writable: true
    });
    const inputs = collect(tree, is("input"));
    assert.equal(inputs.length, 2);
    assert.equal(inputs[0].props.value, "--a");
    const buttons = collect(tree, is("button"));
    // add + two deletes + the one append action.
    assert.equal(buttons.length, 4);
    assert.ok(buttons.some((button) => button.props.children === "Append"));
    assert.equal(written, null);
});

test("SwitchField renders the switch inside one catalog block", async () => {
    const { SwitchField } = await blocks();
    let toggled = 0;
    const tree = SwitchField({ label: "Quiet", hint: "Send bridge output to a log", checked: true, onToggle: () => { toggled++; } });
    const switches = collect(tree, (node) => node.type === "Switch");
    assert.equal(switches.length, 1);
    assert.equal(switches[0].props.checked, true);
    assert.equal(toggled, 0);
});

test("ErrorLine renders nothing on empty text and a dotted line otherwise", async () => {
    const { ErrorLine, LinkButtonRow } = await blocks();
    assert.equal(ErrorLine({ text: "" }), null);
    const tree = ErrorLine({ text: "boom" });
    const status = collect(tree, (node) => node.props && node.props.role === "status");
    assert.equal(status.length, 1);
    assert.ok(collect(tree, (node) => node.props && node.props.children === "boom").length === 1);
    const line = LinkButtonRow({ children: "x" });
    assert.ok(line.props.className.length > 0);
});

/* --- The five editor controls (H8) and the row switch (H9). */

test("LinesField drops the blank lines it is handed and keeps the spaces inside", async () => {
    const { LinesField } = await blocks();
    let written = null;
    const tree = LinesField({
        label: "Arguments",
        value: ["-y", "", "pack age", ""],
        onChange: (next) => { written = next; }
    });
    const textarea = collect(tree, is("textarea"))[0];
    assert.equal(textarea.props.value, "-y\npack age", "a blank item is not a value");
    assert.equal(written, null, "drawing must not write");
});

test("MapField splits on the first `=` and drops a keyless line", async () => {
    const { MapField, parseMap } = await blocks();
    // The bundle is evaluated in its own realm, so compare entries rather than
    // the object graph (a foreign `Object.prototype` is not the same one).
    assert.deepEqual(
        Object.entries(parseMap("A=1\nB=x=y\nNOVAL\n=dropped\nC= ")).sort(),
        [["A", "1"], ["B", "x=y"], ["C", " "]]
    );
    const tree = MapField({ label: "Environment", value: { PATH: "/usr/bin", TZ: "UTC" }, onChange: () => {} });
    const textarea = collect(tree, is("textarea"))[0];
    assert.deepEqual(textarea.props.value.split("\n").sort(), ["PATH=/usr/bin", "TZ=UTC"]);
});

test("LinesField reads one newline-joined string as the same list", async () => {
    const { LinesField } = await blocks();
    // A card that stores its lines as text must draw them, not answer a blank
    // box: the string and the list are two shapes of one value.
    for (const value of ["-y\npack age", ["-y", "pack age"]]) {
        const tree = LinesField({ label: "Arguments", value, onChange: () => {} });
        assert.equal(collect(tree, is("textarea"))[0].props.value, "-y\npack age");
    }
});

test("MapField never answers `object Object` for a value that is not a scalar", async () => {
    const { MapField } = await blocks();
    const tree = MapField({ label: "Environment", value: { ARGS: ["-y", "s"], NAME: "x" }, onChange: () => {} });
    const value = collect(tree, is("textarea"))[0].props.value;
    assert.equal(value.includes("[object Object]"), false);
    assert.deepEqual(value.split("\n").sort(), ["ARGS=-y,s", "NAME=x"]);
});

test("SelectField with no options and nothing held renders a control that answers nothing", async () => {
    const { SelectField } = await blocks();
    const tree = SelectField({ label: "Kind", value: "", onChange: () => {} });
    const select = collect(tree, is("select"))[0];
    assert.equal(select.props.children.length, 0);
});

test("SelectField never loses the value it holds when the served options stop carrying it", async () => {
    const { SelectField } = await blocks();
    const tree = SelectField({
        label: "Profile",
        value: "dev",
        options: [{ value: "default", label: "Default" }, { value: "default", label: "Repeated" }],
        onChange: () => {}
    });
    const options = collect(tree, is("option"));
    assert.deepEqual(options.map((option) => option.props.value), ["default", "dev"], "served first, held value last, no duplicates");
    assert.equal(options[1].props.children, "dev", "a held value nobody describes is labelled as itself");
    assert.equal(collect(tree, is("select"))[0].props.value, "dev");
});

test("DropdownField anchors a Menu on the selector pill under SelectField's option rule", async () => {
    const { DropdownField } = await blocks();
    let picked;
    const tree = DropdownField({
        label: "Kind",
        value: "dev",
        options: [{ value: "stdio", label: "Local command" }, { value: "stdio", label: "Repeated" }],
        onChange: (value) => { picked = value; }
    });
    const menu = collect(tree, is("Menu"))[0];
    assert.deepEqual(JSON.parse(JSON.stringify(menu.props.items)), [{ id: "stdio", label: "Local command" }, { id: "dev", label: "dev" }], "served first, held value last, no duplicates");
    assert.equal(menu.props.selectedId, "dev");
    const label = collect(menu.props.anchor, (node) => node.type === "span")[0];
    assert.equal(label.props.children, "dev", "the pill reads the held choice");
    menu.props.onSelect("dev");
    assert.equal(picked, undefined, "picking the held choice writes nothing");
    menu.props.onSelect("stdio");
    assert.equal(picked, "stdio");
    const disabled = DropdownField({ label: "Kind", value: "", options: [], disabled: true, onChange: () => {} });
    const anchor = collect(disabled, is("Menu"))[0].props.anchor;
    assert.equal(anchor.props.disabled, true, "a disabled dropdown never opens");
});

test("an empty SelectField with a placeholder reads as the placeholder, never as the first option", async () => {
    const { SelectField } = await blocks();
    let picked;
    const tree = SelectField({
        label: "Profile",
        value: "",
        placeholder: "Pick a profile",
        options: [{ value: "default", label: "Default" }],
        onChange: (value) => { picked = value; }
    });
    const options = collect(tree, is("option"));
    assert.deepEqual(options.map((option) => option.props.value), ["", "default"]);
    assert.equal(options[0].props.children, "Pick a profile");
    collect(tree, is("select"))[0].props.onChange({ target: { value: "default" } });
    assert.equal(picked, "default");
});

test("ExtraField draws the control its declared type names", async () => {
    const { ExtraField } = await blocks();
    const text = collect(ExtraField({ label: "Name", type: "string", value: "x", onChange: () => {} }), is("input"));
    assert.equal(text[0].props.type, "text");
    const secret = collect(ExtraField({ label: "Token", type: "secret", value: "x", onChange: () => {} }), is("input"));
    assert.equal(secret[0].props.type, "password");
    const flag = collect(ExtraField({ label: "Enabled", type: "boolean", value: true, onChange: () => {} }), is("input"));
    assert.equal(flag[0].props.type, "checkbox");
    const lines = collect(ExtraField({ label: "Args", type: "lines", value: ["a"], onChange: () => {} }), is("textarea"));
    assert.equal(lines.length, 1);
    const picked = collect(
        ExtraField({ label: "Kind", type: "string", value: "http", options: [{ value: "http", label: "HTTP" }], onChange: () => {} }),
        is("select")
    );
    assert.equal(picked.length, 1);
    const declared = collect(ExtraField({ label: "Profile", type: "select", value: "", onChange: () => {} }), is("select"));
    assert.equal(declared.length, 1, "a declared select stays a select before the Host served any option");
});

test("the row switch renders the control with no box and no title line", async () => {
    const { SwitchField } = await blocks();
    let toggled = 0;
    const tree = SwitchField({ label: "Live", variant: "row", checked: false, onToggle: () => { toggled++; } });
    const control = collect(tree, (node) => node.type === "Switch");
    assert.equal(control.length, 1);
    const wrappers = collect(tree, (node) => node.props && node.props.title !== undefined);
    assert.equal(wrappers.length, 1, "the tooltip rides the wrapper");
    assert.equal(wrappers[0].props["aria-label"], "Live");
    control[0].props.onChange();
    assert.equal(toggled, 1, "the toggle request goes out through the callback the consumer handed");
});

test("ComposerPill anchors a Menu on a pill and never re-picks the current choice", async () => {
    const { ComposerPill } = await blocks();
    const picks = [];
    let opened = null;
    const tree = ComposerPill({
        key: "profile",
        label: "default",
        title: "Docker MCP profile",
        icon: ["M5 10h3v3h-3z"],
        options: [{ id: "default", label: "default" }, { id: "dev", label: "dev" }],
        selectedId: "default",
        onSelect: (id) => { picks.push(id); },
        open: true,
        setOpen: (value) => { opened = value; }
    });
    const menu = collect(tree, (node) => node.type === "Menu")[0];
    assert.equal(menu.props.open, true);
    assert.equal(menu.props.side, "top");
    menu.props.onSelect("default");
    menu.props.onSelect("dev");
    assert.deepEqual(picks, ["dev"], "picking what is selected writes nothing");
    assert.equal(opened, false, "a pick closes the list");
    const button = menu.props.anchor;
    assert.equal(button.props["aria-label"], "Docker MCP profile: default");

    const disabled = ComposerPill({ key: "p", label: "x", options: [], selectedId: "", onSelect: () => {}, open: true, setOpen: () => {}, disabled: true });
    assert.equal(collect(disabled, (node) => node.type === "Menu")[0].props.open, false, "a disabled pill never opens");
});
