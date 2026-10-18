// Shared gamepad picker for menus (menu.js) and battle (input.js).
// navigator.getGamepads()[0] is often null or a phantom on Windows (Xbox Game Bar, a leftover
// XInput device, the WebView wrapper); a real pad — especially a third-party
// "Xbox 360 Controller for Windows" clone — lands in a later slot and may report
// mapping !== 'standard'. Scan every slot, prefer a standard-mapped pad, then any
// connected pad, and stick to the one that last produced input. Non-standard pads
// are remapped to the W3C standard layout (XInput-clone / DirectInput fallback).
const LIVE = 0.25;   // activity / stick-live threshold (a hair above the battle deadzone)

let preferred = -1, hooked = false;

function list() {
  const raw = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    if (p && p.connected !== false) out.push(p);
  }
  return out;
}

function hook() {
  if (hooked || typeof addEventListener !== 'function') return;
  hooked = true;
  addEventListener('gamepadconnected', (e) => { if (e.gamepad && preferred < 0) preferred = e.gamepad.index; });
  addEventListener('gamepaddisconnected', (e) => { if (e.gamepad && e.gamepad.index === preferred) preferred = -1; });
}

const down = (b) => !!(b && (b.pressed || (b.value || 0) > 0.5));
const trig = (v) => v != null && v > 0.5;   // DInput analog triggers rest at 0 / -1, press toward +1

function axesOf(p) {
  const a = p.axes || [];
  const lx = a[0] || 0, ly = a[1] || 0;
  let rx = 0, ry = 0;
  if (p.mapping === 'standard' || a.length <= 4) { rx = a[2] || 0; ry = a[3] || 0; }
  else if (a.length === 5) { rx = a[3] || 0; ry = a[4] || 0; }   // [lx, ly, trigger, rx, ry]
  else {                                                          // 6+: [lx, ly, rx, ry, …] or [lx, ly, lt, rx, ry, rt]
    const a23 = Math.hypot(a[2] || 0, a[3] || 0), a34 = Math.hypot(a[3] || 0, a[4] || 0);
    if (a23 >= a34) { rx = a[2] || 0; ry = a[3] || 0; } else { rx = a[3] || 0; ry = a[4] || 0; }
  }
  return [lx, ly, rx, ry];
}

function pressedAt(p, i) {
  const b = p.buttons || [];
  if (p.mapping === 'standard' || b.length >= 16) return down(b[i]);
  // DirectInput / XInput-clone: A B X Y L1 R1 match; 6/7 are Back/Start, not L2/R2;
  // Start is 7 (standard 9); D-pad is often axes 6/7 rather than buttons 12–15.
  if (i <= 5) return down(b[i]);
  if (i === 6 || i === 7) {
    if (b.length >= 16) return down(b[i]);
    const a = p.axes || [];
    if (a.length >= 6) return trig(i === 6 ? (a[2] ?? a[4]) : (a[5] ?? a[4]));
    if (a.length === 5 && i === 6) return trig(a[2]);
    return false;
  }
  if (i === 8) return down(b[6]);
  if (i === 9) return down(b[7]) || down(b[9]);
  if (i === 10) return down(b[8]);
  if (i === 11) return down(b[9]);
  if (i >= 12 && i <= 15) {
    if (b.length > i) return down(b[i]);
    const a = p.axes || [];
    if (a.length >= 8) {
      const x = a[6] || 0, y = a[7] || 0;
      return i === 12 ? y < -0.5 : i === 13 ? y > 0.5 : i === 14 ? x < -0.5 : x > 0.5;
    }
  }
  return down(b[i]);
}

function activity(p) {
  let n = 0;
  for (const v of axesOf(p)) if (Math.abs(v) > LIVE) n++;
  const lim = Math.max(16, (p.buttons || []).length);
  for (let i = 0; i < lim; i++) if (pressedAt(p, i)) n++;
  return n;
}

function idleScore(p) {
  let s = (p.buttons?.length >= 4 || p.axes?.length >= 2) ? 10 : 0;
  if (p.mapping === 'standard') s += 100;
  s += Math.min(20, p.buttons?.length || 0) + Math.min(8, p.axes?.length || 0);
  if (p.index === preferred) s += 50;
  return s;
}

function pick(pads) {
  if (!pads.length) { preferred = -1; return null; }
  let live = null, best = 0;
  for (const p of pads) {
    const n = activity(p);
    if (n > best || (n === best && live && p.mapping === 'standard' && live.mapping !== 'standard')) {
      if (n > 0) { live = p; best = n; }
    }
  }
  if (live) { preferred = live.index; return live; }
  const keep = pads.find((p) => p.index === preferred);
  if (keep) return keep;
  let chosen = pads[0], score = idleScore(chosen);
  for (const p of pads) { const s = idleScore(p); if (s > score) { chosen = p; score = s; } }
  preferred = chosen.index;
  return chosen;
}

/** Drop the remembered slot (tests; a full disconnect already clears it). */
export function resetPad() { preferred = -1; }

/** The active pad remapped to the standard layout, or null. Call once per poll. */
export function pollPad() {
  hook();
  const p = pick(list());
  if (!p) return null;
  const axes = axesOf(p);
  return { index: p.index, id: p.id, mapping: p.mapping, axes, pressed: (i) => pressedAt(p, i) };
}
