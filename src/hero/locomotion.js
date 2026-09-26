// Hero movement (sim): camera-relative run (instant top speed, velocity follows facing, snap turns with a banked
// lean), dive-roll dodge with i-frames and run/attack/re-dodge cancels, high jump arc with air-attack hover, landing.
// Targets (bench/notes/locomotion-dodge.md): run 4.3-4.9 H/s with no ramp, 180° turn ≤ 6 sf, 5.3 steps/s,
// jump apex 1.3-1.6 H at ≈0.45 s (v0 ≈ 12 m/s, g ≈ 28), dodge back to running ≤ 0.40 s.
import { emit } from '../core/events.js';
import { MOVES } from './moves.js';

export const LOCO = {
  runSpeed: 8.5,        // m/s = 4.6 H/s (DW8 ≈ 4.6 H/s)
  accel: 150,           // m/s²: standstill → top speed in ~3 sim frames (benchmark shows no ramp)
  decel: 60,            // m/s²: release → stop in ~8 frames (short planted skid)
  turnRate: 36,         // rad/s: 180° in 5 sim frames (benchmark ≤ 6)
  turnSlow: 0.3,        // fraction of speed shed at the peak of a 180° snap turn (≈4 H/s straight away)
  dashAfter: 14,        // frames of running before attack becomes a dash attack
  // dive roll: 24 frames (0.40 s) total, run-cancel at 20 (0.33 s), attack at 14, re-dodge at 16
  dodgeFrames: 24, dodgeDist: 4.6, dodgeIFrames: [0, 16], dodgeAttackCancel: 14, dodgeRedodge: 16, dodgeRunCancel: 20,
  jumpV: 12.6, gravity: 28, airControl: 14, hoverG: 0.3,
  hoverSink: 0.1,       // m/s: an air string holds the apex (DW8: ~10 swings in ~2.4 s at about apex height)
  landFrames: 8, landRunCancel: 4, hurtFrames: 20,
};
const DT = 1 / 60, TAU = Math.PI * 2;
const ROLL_PLANT = 13;                  // dodge frame where the roll comes round onto the feet (pose: anims/locomotion.js)
// dash attack: the front foot lands out of the lunge leap 8 sf into the lunge (anims/attacks.js MOVE_FEET.dash)
const DASH_PLANT = MOVES.dash.lunge[1][0] + 8;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Run cadence in steps/s for a ground speed (m/s): 5.3 at top speed (DW8), ≈3.4 at a walk. Shared with the pose. */
export function cadence(v) { return 2.2 + 0.365 * v; }

// Dodge displacement per frame (fraction of dodgeDist): 2-frame push-off, fast dive/roll, long settle into the crouch.
const DODGE_W = (() => {
  const n = LOCO.dodgeFrames, w = [];
  for (let t = 0; t < n; t++) w.push(Math.min(1, (t + 1) / 3.5) * Math.pow(1 - t / n, 1.2) + 0.02);
  const s = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / s);
})();

/** Stick (x right, y forward) → world direction for camera yaw. Returns [dx, dz, magnitude]. */
export function stickDir(inp, camYaw) {
  const m = Math.hypot(inp.mx, inp.my);
  if (m < 0.1) return [0, 0, 0];
  const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
  const dx = fx * inp.my - fz * inp.mx, dz = fz * inp.my + fx * inp.mx;
  const l = Math.hypot(dx, dz);
  return [dx / l, dz / l, Math.min(1, m)];
}

export function turnToward(h, targetYaw, maxStep) {
  h.yaw += clamp(wrap(targetYaw - h.yaw), -maxStep, maxStep);
}

export function setState(h, s) { if (h.state !== s) { h.state = s; h.stateT = 0; } }

/** Banked lean fed to the run pose (h.anim.lean, + = leaning left); decays outside the run. */
function bank(h, dyaw) {
  const want = clamp(dyaw * 60 * h.speed * 0.02, -0.42, 0.42);
  h.anim.lean += (want - h.anim.lean) * 0.35;
}

/** Grounded/air free movement (not attacking). */
export function stepLocomotion(h, inp, camYaw) {
  const [dx, dz, mag] = stickDir(inp, camYaw);
  if (h.state === 'dodge') return stepDodge(h, mag);
  if (h.state === 'hurt') {
    h.vx *= 0.85; h.vz *= 0.85; h.anim.lean *= 0.7;
    if (h.stateT >= LOCO.hurtFrames) setState(h, 'idle');
    return;
  }
  if (h.state === 'land') {                // planted landing crouch; stick breaks out early into the run
    if (h.stateT >= LOCO.landFrames || (mag && h.stateT >= LOCO.landRunCancel)) setState(h, mag ? 'run' : 'idle');
    else { h.vx *= 0.75; h.vz *= 0.75; h.speed = Math.hypot(h.vx, h.vz); h.anim.lean *= 0.7; return; }
  }
  if (!h.grounded) {                       // air control (momentum from the run carries)
    const tvx = dx * LOCO.runSpeed * mag, tvz = dz * LOCO.runSpeed * mag;
    if (mag) {
      h.vx += clamp(tvx - h.vx, -LOCO.airControl * DT, LOCO.airControl * DT);
      h.vz += clamp(tvz - h.vz, -LOCO.airControl * DT, LOCO.airControl * DT);
      turnToward(h, Math.atan2(dx, dz), LOCO.turnRate * 0.5 * DT);
    }
    h.anim.lean *= 0.8;
    return;
  }
  const yaw0 = h.yaw, sp0 = Math.hypot(h.vx, h.vz);
  let sp;
  if (mag) {
    const want = Math.atan2(dx, dz);
    if (sp0 < 1.5 && h.state !== 'run') h.yaw = want;          // from a standstill: face the stick at once
    else turnToward(h, want, LOCO.turnRate * DT);
    const left = Math.abs(wrap(want - h.yaw));                  // still turning → shed some speed (no skid)
    const target = LOCO.runSpeed * mag * (1 - LOCO.turnSlow * left / Math.PI);
    sp = sp0 + clamp(target - sp0, -LOCO.decel * DT, LOCO.accel * DT);
    h.vx = Math.sin(h.yaw) * sp; h.vz = Math.cos(h.yaw) * sp;  // velocity follows facing: tight arc, no drift
    setState(h, 'run');
    h.runT++;
  } else {
    const st = LOCO.decel * DT;
    if (sp0 > st) { h.vx -= h.vx / sp0 * st; h.vz -= h.vz / sp0 * st; } else { h.vx = h.vz = 0; }
    sp = Math.max(0, sp0 - st);
    h.runT = 0;
    if (h.state === 'run' && sp < 1.5) setState(h, 'idle');
  }
  h.speed = sp;
  bank(h, wrap(h.yaw - yaw0));
  // stride phase (2π = two steps); a foot plants every π → footstep event for dust/audio
  const p0 = h.runPhase, p1 = p0 + Math.PI * cadence(sp) * DT;
  if (h.state === 'run' && sp > 2.5 && Math.floor(p1 / Math.PI) > Math.floor(p0 / Math.PI)) {
    const left = Math.floor(p1 / Math.PI) % 2 === 0, s = Math.sin(h.yaw), c = Math.cos(h.yaw), lat = left ? 0.11 : -0.11;
    emit('footstep', { x: h.x + s * 0.35 + c * lat, y: 0, z: h.z + c * 0.35 - s * lat, foot: left ? 'L' : 'R', speed: sp });
  }
  h.runPhase = p1 % (TAU * 64);
}

export function startDodge(h, inp, camYaw) {
  let [dx, dz, mag] = stickDir(inp, camYaw);
  if (!mag) { dx = Math.sin(h.yaw); dz = Math.cos(h.yaw); }
  h.yaw = Math.atan2(dx, dz);
  h.dodgeX = dx; h.dodgeZ = dz;
  h.move = null;
  h.state = 'dodge'; h.stateT = 0;        // always restart (setState keeps stateT when already dodging → dead 2nd dodge)
  h.dodgeSeq++;                           // re-triggers the anim blend for dodge → dodge
  h.iframes = LOCO.dodgeIFrames[1];
  h.vx = h.vz = 0; h.speed = 0; h.runT = 0;
  emit('dodge', { x: h.x, y: h.y, z: h.z, dx, dz });
}

function stepDodge(h, mag) {
  const t = h.stateT;
  if (t < LOCO.dodgeFrames) { const d = LOCO.dodgeDist * DODGE_W[t]; h.x += h.dodgeX * d; h.z += h.dodgeZ * d; }
  h.anim.lean *= 0.7;
  if (t === ROLL_PLANT) emit('footstep', { x: h.x, y: 0, z: h.z, foot: 'R', speed: 7, kick: 1 });   // feet plant out of the roll
  if (t >= LOCO.dodgeFrames || (mag && t >= LOCO.dodgeRunCancel)) {
    // come out of the crouch already moving, so the run picks up without a dead frame
    const v = mag ? LOCO.runSpeed * 0.6 : 0;
    h.vx = h.dodgeX * v; h.vz = h.dodgeZ * v; h.speed = v;
    setState(h, 'idle');
  }
}

export function startJump(h) {
  h.vy = LOCO.jumpV;
  h.grounded = false;
  h.airAttack = false;
  h.airHold = false;                      // set once an air string has topped out: from then on it holds altitude
  setState(h, 'jump');
  emit('jump', { x: h.x, y: h.y, z: h.z });
}

/** Gravity + integration + landing. Returns true on the frame the hero touches down. */
export function stepPhysics(h) {
  if (h.state !== 'dodge') { h.x += h.vx * DT; h.z += h.vz * DT; }
  if (h.move === 'dash' && h.moveT === DASH_PLANT && h.grounded) {       // DW8: the lunge thrust lands in a dust cloud
    emit('footstep', { x: h.x + Math.sin(h.yaw) * 0.4, y: 0, z: h.z + Math.cos(h.yaw) * 0.4, foot: 'L', speed: LOCO.runSpeed, kick: 1 });
  }
  if (h.grounded) return false;
  const m = h.state === 'attack' && h.move && MOVES[h.move];
  if (m && m.air && !m.landFrame) {
    // air string (benchmark: DW8 A→X×n hangs at about apex height for ~2.4 s, then a ≈0.4 s spread-arm fall): the jump
    // finishes its rise on the normal arc, then holds altitude with a slow sink. Each swing's re-lift (combo startMove)
    // is overridden here, so a long string never climbs; when the swings stop, gravity takes over.
    if (!h.airHold && h.vy > 0) h.vy -= LOCO.gravity * DT;
    else { h.airHold = true; h.vy = Math.min(-LOCO.hoverSink, h.vy * 0.7); }   // a swing started in a fall catches it
  } else if (m && m.air && h.vy <= 0 && h.vy > -8) h.vy = Math.max(-1.5, h.vy * 0.85 - LOCO.gravity * LOCO.hoverG * DT);   // jump charge: hang
  // (a jump charge's rise keeps the full jump arc up to the apex, where its hang starts: combo advance holds hang[0])
  else h.vy -= LOCO.gravity * DT;
  h.y += h.vy * DT;
  if (h.y <= 0) {
    const hard = h.vy < -15;
    h.y = 0; h.vy = 0; h.grounded = true; h.airHold = false;
    if (h.airN) h.buf = null;               // leftover air-string taps don't leak into a ground N1 on touchdown
    emit('land', { x: h.x, y: 0, z: h.z, hard });
    return true;
  }
  return false;
}
