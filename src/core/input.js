// Input → actions from keyboard, mouse and gamepad.
// The sim calls sample() exactly once per fixed step; "pressed" edges are latched so a tap
// between two steps is never lost.
// Camera look (out.orbit = yaw, out.tilt = pitch, rad per step; + orbit turns the view left, + tilt looks down):
//   mouse   pointer lock once the battle is on (the click that takes the lock does not attack; later clicks attack /
//           charge as usual). Losing the lock mid-battle (Esc, alt-tab) pauses like a window blur.
//   Q / E   yaw with a short ramp: 0.9 rad/s on the tap (fine nudge) → 2.6 rad/s after ≈0.35 s held (DW8 pad feel)
//   pad     right stick yaw + pitch, cubic response, rate eased over ≈4 steps (no twitch off the deadzone)
//   R / L1 / L2   'target': recenter behind the hero, or onto the nearest officer (camera.js)
import { on } from './events.js';
import { pollPad as readPad } from './pad.js';

const ACTIONS = ['attack', 'charge', 'jump', 'dodge', 'musou', 'target'];

const KEYMAP = {
  KeyJ: 'attack', KeyK: 'charge', Space: 'jump', KeyL: 'dodge',
  ShiftLeft: 'dodge', ShiftRight: 'dodge', KeyI: 'musou', KeyR: 'target',
};
const MOVEKEYS = {
  KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};
// Gamepad (standard mapping): A/× jump, X/□ attack, Y/△ charge, B/○ musou, R1/R2 dodge, L1/L2 camera target / recenter.
const PADMAP = { 0: 'jump', 2: 'attack', 3: 'charge', 1: 'musou', 5: 'dodge', 7: 'dodge', 4: 'target', 6: 'target' };
const LOOK = {
  mouseYaw: 0.0024, mousePitch: 0.0018,   // rad per px of pointer-lock movement
  keyRate: [0.9, 2.6], keyRamp: 21,        // Q/E: rad/s on the tap → held, steps to reach full rate
  padYaw: 2.8, padPitch: 1.3, padEase: 0.3, padDead: 0.18,   // right stick: max rad/s, per-step easing, radial deadzone
};

export function createInput() {
  const dev = { held: {}, latch: {}, keys: new Set(), lookX: 0, lookY: 0, pad: {}, keyT: 0, padYaw: 0, padPitch: 0 };
  const out = { mx: 0, my: 0, orbit: 0, tilt: 0, pressed: {}, held: {} };
  const canvas = document.getElementById('c'), menu = document.getElementById('menu');
  // noLock: a click's lock request was refused (sandboxed frame, lock cooldown): clicks attack until the next battle /
  // resume · clickLock: the pending request came from a canvas click
  let battle = false, unlockT = -1e9, noLock = false, clickLock = false;
  const locked = () => document.pointerLockElement === canvas;
  const live = () => battle && menu && menu.hidden;                 // battle running, pause menu closed
  // requestPointerLock returns a promise in current browsers (rejects without a user gesture, e.g. the ?go= shortcut)
  const lock = (click = false) => { clickLock = click; if (live() && !locked() && !noLock) { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { noLock = true; } } };

  on('flow', (e) => {
    battle = e.state === 'battle';
    if (battle) { noLock = false; lock(); }                         // flow.go('battle') usually runs inside a click / key
    else if (locked()) document.exitPointerLock();
  });
  // refused: only a refusal to a click stops asking (a flow / resume request may lack a gesture, e.g. the ?go= shortcut),
  // so a page that cannot lock still attacks on click and orbits with Q/E / the pad
  document.addEventListener('pointerlockerror', () => { if (clickLock) noLock = true; });
  document.addEventListener('pointerlockchange', () => {
    if (locked() || !live()) return;
    // lock lost mid-battle (Esc, alt-tab): pause through main.js's window-blur handler (idempotent setPaused(true)).
    // The Esc that released the lock must not also reach main.js's Esc toggle and unpause (see the capture below).
    unlockT = performance.now();
    dispatchEvent(new Event('blur'));
  });
  document.getElementById('go')?.addEventListener('click', () => { noLock = false; setTimeout(lock); });   // resume button → take the mouse back
  addEventListener('keydown', (e) => {                              // capture: runs before main.js's Esc toggle
    if (e.code === 'Escape' && performance.now() - unlockT < 300) e.stopImmediatePropagation();
  }, true);

  addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    dev.keys.add(e.code);
    const a = KEYMAP[e.code];
    if (a && !e.repeat) { dev.held[a] = true; dev.latch[a] = true; }
  });
  addEventListener('keyup', (e) => {
    dev.keys.delete(e.code);
    const a = KEYMAP[e.code];
    if (a) dev.held[a] = false;
  });
  addEventListener('blur', () => { dev.keys.clear(); for (const a of ACTIONS) dev.held[a] = false; });
  addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('pointerdown', (e) => {
    if (e.target.closest && e.target.closest('button,a,input')) return;
    if (live() && !locked() && !noLock) { lock(true); return; }   // this click only takes the mouse
    const a = e.button === 0 ? 'attack' : e.button === 2 ? 'charge' : null;
    if (a) { dev.held[a] = true; dev.latch[a] = true; }
  });
  addEventListener('pointerup', (e) => {
    const a = e.button === 0 ? 'attack' : e.button === 2 ? 'charge' : null;
    if (a) dev.held[a] = false;
  });
  addEventListener('pointermove', (e) => { if (locked()) { dev.lookX += e.movementX; dev.lookY += e.movementY; } });

  function pollPad() {
    const p = readPad();
    if (!p) { for (const k of Object.keys(dev.pad)) dev.pad[k] = false; return null; }
    for (const [btn, a] of Object.entries(PADMAP)) {
      const down = p.pressed(+btn);
      if (down && !dev.pad[btn]) dev.latch[a] = true;
      dev.pad[btn] = down;
    }
    return p;
  }

  function sample() {
    let mx = 0, my = 0, orbit = 0, tilt = 0;
    const pad = pollPad();
    for (const k of dev.keys) { const m = MOVEKEYS[k]; if (m) { mx += m[0]; my += m[1]; } }
    let wantYaw = 0, wantPitch = 0;
    if (pad) {
      const dz = (v) => (Math.abs(v) < LOOK.padDead ? 0 : v);
      mx += dz(pad.axes[0] || 0); my -= dz(pad.axes[1] || 0);
      const rx = pad.axes[2] || 0, ry = pad.axes[3] || 0, r = Math.hypot(rx, ry);
      if (r > LOOK.padDead) {                                        // radial deadzone, rescaled, cubic response
        const k = Math.min(1, (r - LOOK.padDead) / (1 - LOOK.padDead)) ** 3 / r;
        wantYaw = -rx * k * LOOK.padYaw; wantPitch = ry * k * LOOK.padPitch;
      }
    }
    // eased toward the stick; snapped to 0 once released and settled, so a stale tail never counts as a manual look
    dev.padYaw += (wantYaw - dev.padYaw) * LOOK.padEase; dev.padPitch += (wantPitch - dev.padPitch) * LOOK.padEase;
    if (!wantYaw && Math.abs(dev.padYaw) < 0.02) dev.padYaw = 0;
    if (!wantPitch && Math.abs(dev.padPitch) < 0.02) dev.padPitch = 0;
    orbit += dev.padYaw / 60; tilt += dev.padPitch / 60;
    const q = dev.keys.has('KeyQ') - dev.keys.has('KeyE');
    dev.keyT = q ? dev.keyT + 1 : 0;
    orbit += q * (LOOK.keyRate[0] + (LOOK.keyRate[1] - LOOK.keyRate[0]) * Math.min(1, dev.keyT / LOOK.keyRamp)) / 60;
    orbit -= dev.lookX * LOOK.mouseYaw; tilt += dev.lookY * LOOK.mousePitch; dev.lookX = dev.lookY = 0;
    for (const a of ACTIONS) {
      out.pressed[a] = !!dev.latch[a];
      out.held[a] = !!dev.held[a];
      dev.latch[a] = false;
    }
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    out.mx = mx; out.my = my; out.orbit = orbit; out.tilt = tilt;
    return out;
  }

  return { sample };
}
