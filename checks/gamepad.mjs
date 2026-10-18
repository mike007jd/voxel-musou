// Run: node checks/gamepad.mjs
// Gamepad slot selection, non-standard mapping fallback, menu nav and battle sample().
// No renderer: navigator.getGamepads is mocked. Covers the Windows v0.2 report
// (https://github.com/mike007jd/voxel-musou/issues/8): a real pad ignored because
// the game only read slot 0.
import assert from 'node:assert/strict';

const listeners = {};
const slots = [];
const raf = [];
globalThis.addEventListener = (t, fn) => { (listeners[t] ??= []).push(fn); };
globalThis.dispatchEvent = (e) => { for (const fn of listeners[e.type] || []) fn(e); };
navigator.getGamepads = () => slots;
globalThis.requestAnimationFrame = (fn) => { raf.push(fn); return raf.length; };
globalThis.cancelAnimationFrame = () => {};
globalThis.performance = globalThis.performance || { now: () => 0 };

const el = () => {
  const node = { hidden: true, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    animate: () => ({ finished: Promise.resolve() }), getAnimations: () => [],
    innerHTML: '', textContent: '', offsetWidth: 0 };
  return node;
};
const ink = el(), body = { classList: { add() {}, remove() {} } };
const nodes = { c: el(), menu: el(), go: el(), ink };
globalThis.document = {
  getElementById: (id) => nodes[id] || el(),
  body,
  pointerLockElement: null,
  exitPointerLock() {},
  addEventListener() {},
};

const { pollPad, resetPad } = await import('../src/core/pad.js');
const { createInput } = await import('../src/core/input.js');
const { createNav } = await import('../src/ui/menu.js');

function btn(n, down = {}) {
  return Array.from({ length: n }, (_, i) => {
    const v = down[i];
    if (v && typeof v === 'object') return { pressed: !!v.pressed, value: v.value ?? (v.pressed ? 1 : 0) };
    return { pressed: !!v, value: v ? 1 : 0 };
  });
}
function gp({ index = 0, mapping = 'standard', id = 'Controller (Xbox 360 Controller for Windows)',
  axes = [0, 0, 0, 0], n = mapping === 'standard' ? 17 : 10, down = {}, buttons } = {}) {
  return { index, mapping, id, connected: true, timestamp: 1, axes: axes.slice(), buttons: buttons || btn(n, down) };
}
function setPads(list) {
  slots.length = 0;
  for (let i = 0; i < list.length; i++) slots[i] = list[i];
}
function fire(type, pad) { dispatchEvent(Object.assign(new Event(type), { gamepad: pad })); }
function flush(now = 0) { const q = raf.splice(0); for (const fn of q) fn(now); }

function assertPad(want, msg) {
  const p = pollPad();
  if (want == null) { assert.equal(p, null, msg); return; }
  assert.ok(p, msg || 'expected a pad');
  if (want.index != null) assert.equal(p.index, want.index, msg);
  if (want.pressed) for (const [i, v] of Object.entries(want.pressed)) {
    assert.equal(p.pressed(+i), v, `${msg || 'button'} ${i}`);
  }
  if (want.axes) for (let i = 0; i < want.axes.length; i++) {
    assert.ok(Math.abs(p.axes[i] - want.axes[i]) < 1e-6, `${msg || 'axis'} ${i}`);
  }
}

// ---- slot selection -------------------------------------------------------
resetPad();
setPads([gp({ index: 0, down: { 0: true }, axes: [0.8, 0, 0, 0] })]);
assertPad({ index: 0, pressed: { 0: true }, axes: [0.8, 0, 0, 0] }, 'slot 0 regression');

resetPad();
setPads([null, gp({ index: 1, down: { 2: true }, axes: [0, -0.9, 0, 0] })]);
assertPad({ index: 1, pressed: { 2: true }, axes: [0, -0.9, 0, 0] }, 'null slot 0, real pad in slot 1');

resetPad();
const phantom = gp({ index: 0, mapping: '', id: 'HID phantom', n: 0, axes: [] });
phantom.buttons = [];
setPads([phantom, gp({ index: 1, down: { 0: true } })]);
assertPad({ index: 1, pressed: { 0: true } }, 'standard pad + phantom in slot 0');

resetPad();
setPads([gp({ index: 0, mapping: '', id: 'idle clone', n: 10 }), gp({ index: 1, mapping: 'standard', id: 'Xbox' })]);
assertPad({ index: 1 }, 'idle: prefer standard mapping over a non-standard sibling');

resetPad();
setPads([gp({ index: 0, mapping: 'standard' }), gp({ index: 1, mapping: 'standard', down: { 1: true } })]);
assertPad({ index: 1 }, 'two standard pads: the one with live input wins');

// ---- non-standard mapping -------------------------------------------------
resetPad();
setPads([gp({
  index: 2, mapping: '', id: 'clone', n: 10,
  down: { 0: true, 2: true, 7: true },          // A, X, DInput Start
  axes: [0.4, -0.6, 0.1, 0.7, -0.5],            // 5-axis: rx/ry at 3,4
})]);
assertPad({
  index: 2,
  pressed: { 0: true, 2: true, 9: true, 1: false },
  axes: [0.4, -0.6, 0.7, -0.5],
}, 'DirectInput clone: Start@7 → standard 9, right stick at axes 3/4');

resetPad();
setPads([gp({
  index: 0, mapping: '', n: 10,
  axes: [0, 0, 0, 0, 0, 0, 0, 1],               // hat down
})]);
assertPad({ index: 0, pressed: { 13: true, 12: false } }, 'non-standard d-pad as hat axes 6/7');

resetPad();
setPads([gp({
  index: 0, mapping: 'standard', n: 17,
  buttons: btn(17, { 2: { pressed: false, value: 1 } }),   // clone reports value only
})]);
assertPad({ index: 0, pressed: { 2: true } }, 'pressed falls back to value > 0.5');

// ---- disconnect / reconnect ----------------------------------------------
resetPad();
const pad1 = gp({ index: 1, down: { 0: true } });
setPads([null, pad1]);
assertPad({ index: 1 }, 'connected in slot 1');
setPads([null, null]);
fire('gamepaddisconnected', { index: 1 });
assertPad(null, 'gone after disconnect');
const pad1b = gp({ index: 1 });
setPads([null, pad1b]);
fire('gamepadconnected', pad1b);
assertPad({ index: 1 }, 'same slot after reconnect (remembered / connect event)');

resetPad();
setPads([]);
assertPad(null, 'no pads');
const fresh = gp({ index: 0 });
setPads([fresh]);
fire('gamepadconnected', fresh);
assertPad({ index: 0 }, 'first connect fills an empty selection');

// ---- battle sample() ------------------------------------------------------
function battle(p) {
  resetPad();
  setPads(p);
  const input = createInput();
  input.sample();                         // seed held-state (no edge on a button already down at boot)
  return input;
}
{
  const input = battle([null, gp({ index: 1, axes: [0.9, -0.8, 0, 0] })]);
  const s = input.sample();
  assert.ok(s.mx > 0.5 && s.my > 0.5, `battle move from slot 1 (mx=${s.mx} my=${s.my})`);
}
{
  const input = battle([null, gp({ index: 1 })]);
  setPads([null, gp({ index: 1, down: { 2: true } })]);
  const a = input.sample();
  assert.equal(a.pressed.attack, true, 'X / □ attack');
  setPads([null, gp({ index: 1, down: { 3: true } })]);
  assert.equal(input.sample().pressed.charge, true, 'Y / △ charge');
  setPads([null, gp({ index: 1, down: { 0: true } })]);
  assert.equal(input.sample().pressed.jump, true, 'A / × jump');
  setPads([null, gp({ index: 1, down: { 5: true } })]);
  assert.equal(input.sample().pressed.dodge, true, 'R1 dodge');
  setPads([null, gp({ index: 1, down: { 7: true } })]);
  assert.equal(input.sample().pressed.dodge, true, 'R2 dodge');
  setPads([null, gp({ index: 1, down: { 1: true } })]);
  assert.equal(input.sample().pressed.musou, true, 'B / ○ musou');
  setPads([null, gp({ index: 1, down: { 4: true } })]);
  assert.equal(input.sample().pressed.target, true, 'L1 target');
}
{
  const input = battle([gp({ index: 0, mapping: '', n: 10, axes: [0, 0, 0, 0.9, -0.4] })]);
  let orbit = 0, tilt = 0;
  for (let i = 0; i < 8; i++) { const s = input.sample(); orbit += s.orbit; tilt += s.tilt; }
  assert.ok(orbit < 0, `clone right-stick yaw (orbit=${orbit})`);
  assert.ok(tilt < 0, `clone right-stick pitch (tilt=${tilt})`);
}

// ---- menu nav (createNav) -------------------------------------------------
{
  const got = { move: 0, ok: 0, back: 0 };
  const nav = createNav({ move: (d) => { got.move += d; }, ok: () => { got.ok++; }, back: () => { got.back++; } });
  resetPad();
  setPads([null, gp({ index: 1 })]);
  nav.start();
  flush(0);
  setPads([null, gp({ index: 1, down: { 0: true } })]);
  flush(16);
  assert.equal(got.ok, 1, 'menu A (slot 1) confirms');
  setPads([null, gp({ index: 1 })]);
  flush(32);
  setPads([null, gp({ index: 1, down: { 1: true } })]);
  flush(48);
  assert.equal(got.back, 1, 'menu B goes back');
  setPads([null, gp({ index: 1 })]);
  flush(64);
  setPads([null, gp({ index: 1, down: { 13: true } })]);
  flush(80);
  assert.equal(got.move, 1, 'menu d-pad down');
  nav.stop();
}
{
  // stick-up edge: start idle, then push up
  const got = [];
  const nav = createNav({ move: (d) => { got.push(d); }, ok() {}, back() {} });
  resetPad();
  setPads([null, gp({ index: 1 })]);
  nav.start();
  flush(0);
  setPads([null, gp({ index: 1, axes: [0, -0.9, 0, 0] })]);
  flush(10);
  assert.deepEqual(got, [-1], 'menu left-stick up');
  setPads([null, gp({ index: 1, axes: [0.9, 0, 0, 0] })]);
  flush(20);
  assert.deepEqual(got, [-1, 1], 'menu left-stick right');
  nav.stop();
}
{
  const got = { ok: 0 };
  const nav = createNav({ move() {}, ok: () => { got.ok++; }, back() {} });
  resetPad();
  setPads([gp({ index: 0, mapping: '', n: 10, down: { 7: true } })]);   // DInput Start held at open
  nav.start();
  flush(0);
  assert.equal(got.ok, 0, 'Start already held at start() does not confirm');
  setPads([gp({ index: 0, mapping: '', n: 10 })]);
  flush(16);
  setPads([gp({ index: 0, mapping: '', n: 10, down: { 7: true } })]);
  flush(32);
  assert.equal(got.ok, 1, 'DInput Start (button 7) is menu Start');
  nav.stop();
}

console.log('Gamepad slot pick, mapping fallback, disconnect, menu nav and battle sample — passed');
