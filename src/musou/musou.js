// Musou (sim): Zhao Yun's 真・無雙 modelled on the DW8XL ground Musou (bench/notes/musou.md), plus a voxel azure dragon.
// Timeline (musou frames t; t = 1 on the first step after the press; hitstop pauses it):
//   0  activation — world freezes, an aura shock pushes the nearest soldiers back (clears the stage), spear raised
//   30 close-up cut-in (≈1 s)          88 pull-back to a charge stance          100 chase run (steerable)
//   132 CONTACT (2.2 s): radial blast + a shock front rolling 15 m through the crowd ahead (launch fan, CHAIN ≈ 100 in
//       0.25 s), the dragon bursts from the spear tip and surges through the crowd; the camera whips round to the flank
//       that faces away from the sun (front-lit fan), holds low while the bodies fly, then eases back for the finisher
//   166 hard cut to a low wide shot from behind him as the dragon rears for its dive (r3)
//   176 FINISHER: the dragon dives onto Zhao Yun and coils skyward; a ring wave launches everything in tiers
//   200 control returns (≈3.35 s)
// Emits musou:ready/start/hit/burst/end. The camera asks mu.shot() for the shot list; src/musou/view.js renders the
// grade, motes, dragon and payoff light from this state (dragonPath is shared so the hits land where the dragon is).
import { emit } from '../core/events.js';
import { CLIPS } from '../hero/hero.js';
import { P, clip, spearAbout } from '../hero/rig.js';
import { setState, stickDir, turnToward } from '../hero/locomotion.js';
import { ST, wrap } from '../crowd/crowd.js';
import { SUN_DIR } from '../world/sky.js';

export const MUSOU = {
  closeup: 30, pullback: 88, chase: 100, contact: 132, finisher: 176, end: 200,
  aura: { r0: 5.2, k: 0.35, frames: 5 },   // d < r0/(1-k) → pushed out to r0 + d·k over `frames`
  chaseSpeed: 10, chaseTurn: 2.4,          // m/s, rad/s
  rushDist: 2.4,                           // hero drives this far behind the dragon (m, over 0.6 s)
  waveR: 12, waveFrames: 18,
  // r3: bench launch = 0.5–1.5 H up and 2–4 H back in a fan. The contact fan is a 'blow' (thrown back along the blast;
  // a sector 'launch' gathered the bodies into a pile toward him), and the rush re-hits only juggle bodies below ≈1.4 H
  // (yMax ≈ 1 H), so the fan hangs at chest-to-head height while the dragon tears through it instead of being popped up a
  // little more every tick (it climbed to 4 m and was still airborne 0.6 s after control returned)
  contactHit: { shape: 'sector', range: 9.5, ang: 210, dmg: 12, kb: 'blow', force: 6.5, lift: 8.2, hitstop: 3, yMax: 5 },
  // the contact shock front rolls on through the crowd ahead (bench: CHAIN 9→91 in 0.4 s, a 20–35 body launch fan)
  front: { frames: 24, r0: 4, r1: 15, ang: 180 },
  backHit: { shape: 'circle', range: 3.2, dmg: 12, kb: 'launch', force: 5, lift: 7, hitstop: 0, yMax: 5 },
  dragonHit: { shape: 'circle', range: 2.7, dmg: 16, kb: 'launch', force: 5.5, lift: 6, hitstop: 0, yMax: 1.9 },
  heroHit: { shape: 'circle', range: 3.0, dmg: 7, kb: 'launch', force: 4.5, lift: 5, hitstop: 0, yMax: 1.7 },
  waveHit: { shape: 'circle', range: 0, dmg: 60, kb: 'blow', force: 7.5, lift: 9.5, hitstop: 0, heavy: true, yMax: 6 },
  cost: 1 / 3,                             // one Musou spends one of the gauge's 3 segments (DW8)
};

// ---------------------------------------------------------------- dragon path (pure; shared with the view)
// Keys [s seconds after contact, left, up, forward] in the contact frame (origin = hero at contact, +forward = facing).
// Surge ahead, sweep broadside through the crowd on the left — the far side from the payoff camera (mu.side mirrors it),
// so it reads as a serpent crossing the frame — rear up high on that side and dive onto Zhao Yun for the finisher coil
// (it never loops over the camera's side: the old arc passed 3 m from the lens and blotted out the finisher).
const DK = [
  [-0.08, 0, 1.25, 0.4], [0, 0, 1.4, 1.9], [0.08, 0.5, 2.1, 5.6], [0.16, 2.4, 2.5, 8.4], [0.25, 5.6, 2.4, 8.4],
  [0.34, 7.2, 2.6, 3.4], [0.43, 5.6, 3.6, 0.6], [0.52, 3.2, 5.4, 0.4], [0.6, 1.4, 6.0, 2.2], [0.67, 0.6, 4.2, 3.6],
];
{ // coil: dive onto the hero (at forward = rushDist) and spiral up around him
  const s0 = MUSOU.finisher - MUSOU.contact, c = MUSOU.rushDist;
  for (let k = 0; k <= 24; k++) {
    const s = s0 / 60 + k * 0.03, a = k * 0.03 * 13, r = 1.7 + k * 0.03 * 0.9;
    DK.push([s, r * Math.sin(a), 1.1 + k * 0.03 * 14, c + r * Math.cos(a)]);
  }
}
const cr = (a, b, c, d, u) => 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (3 * b - a - 3 * c + d) * u * u * u);
function pathRaw(s, out) {
  let i = 0;
  while (i < DK.length - 2 && s >= DK[i + 1][0]) i++;
  const a = DK[Math.max(0, i - 1)], b = DK[i], c = DK[i + 1], d = DK[Math.min(DK.length - 1, i + 2)];
  const u = Math.min(1, Math.max(0, (s - b[0]) / (c[0] - b[0])));
  for (let j = 1; j < 4; j++) out[j - 1] = cr(a[j], b[j], c[j], d[j], u);
  return out;
}
// arc-length table so the body can be spaced evenly along the path
const TS0 = DK[0][0], TDT = 1 / 480, TN = Math.ceil((DK[DK.length - 1][0] - TS0) / TDT) + 1;
const TAB = new Float32Array(TN * 3), ARC = new Float32Array(TN);
{
  const p = [0, 0, 0];
  for (let k = 0; k < TN; k++) {
    pathRaw(TS0 + k * TDT, p); TAB.set(p, k * 3);
    ARC[k] = k ? ARC[k - 1] + Math.hypot(p[0] - TAB[k * 3 - 3], p[1] - TAB[k * 3 - 2], p[2] - TAB[k * 3 - 1]) : 0;
  }
}
const ARC0 = ARC[Math.round(-TS0 / TDT)];                  // arc length where the dragon leaves the spear tip
/** Arc length (m past the spear tip) of the head at s seconds after contact. */
export function dragonArc(s) {
  const f = Math.min(TN - 1, Math.max(0, (s - TS0) / TDT)), k = Math.floor(f), u = f - k;
  return (k + 1 < TN ? ARC[k] + (ARC[k + 1] - ARC[k]) * u : ARC[k]) - ARC0;
}
/** Point on the path at arc length a (m past the spear tip), contact frame [left, up, fwd]. */
export function dragonAt(a, out) {
  a += ARC0;
  let lo = 0, hi = TN - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ARC[m] < a) lo = m; else hi = m; }
  const u = ARC[hi] > ARC[lo] ? Math.min(1, Math.max(0, (a - ARC[lo]) / (ARC[hi] - ARC[lo]))) : 0;
  for (let j = 0; j < 3; j++) out[j] = TAB[lo * 3 + j] + (TAB[hi * 3 + j] - TAB[lo * 3 + j]) * u;
  return out;
}

// ---------------------------------------------------------------- hero clips (registered into the hero's clip registry)
const FEET = { footL: [0.24, 0.08, 0.14, 0, 20], footR: [-0.24, 0.08, -0.14, 0, -20] };
const OVERHEAD = { ...FEET, hips: [0, 0.94, 0], hipsR: [-4, -8, 0], spine: [-6, 0, 0], chest: [-10, 0, 0], head: [-14, 0, 0],
  spear: spearAbout([0, 1.98, 0.1], 90, 24, 0, 0.9), gripR: 0.64, gripL: 1.18 };
const RAISE = { ...FEET, hips: [0, 0.92, 0], hipsR: [0, -12, 0], spine: [-2, -4, 0], chest: [-5, -6, 0], head: [-6, -18, 0],
  spear: spearAbout([-0.36, 1.55, 0.18], 6, 86, 0, 0.9), gripR: 0.72, lfree: 1, armL: [-30, 0, 55, 25] };
const FACE = { ...FEET, hips: [0, 0.9, 0], hipsR: [0, -24, 0], spine: [2, -6, 0], chest: [0, -8, 0], head: [2, -22, 0],
  spear: spearAbout([0.02, 1.38, 0.3], 62, 52, 0, 0.9), gripR: 0.48, gripL: 1.02 };
const CHARGE = { hips: [0, 0.74, 0.08], hipsR: [20, -38, 0], spine: [8, -6, 0], chest: [4, -8, 0], head: [0, 0, 0],
  footL: [0.2, 0.08, 0.46, 0, 10], footR: [-0.22, 0.1, -0.42, 30, -40], spear: [-0.2, 1.0, -0.22, 4, -4, 90], gripR: 0.12, gripL: 0.64 };
const THRUST = { hips: [0, 0.76, 0.26], hipsR: [8, -72, 0], spine: [6, -8, 0], chest: [2, -6, 0], head: [0, 0, 0],
  footL: [0.2, 0.08, 0.74, 0, 10], footR: [-0.24, 0.08, -0.42, 20, -60], spear: [-0.04, 1.2, 0.68, 0, 3, 90], gripL: 0.3 };
const WIDE = { hips: [0, 0.78, 0.06], footL: [0.32, 0.08, 0.36, 0, 25], footR: [-0.32, 0.08, -0.28, 0, -50] };
const SWEEP = (hy, sy, extra) => ({ ...WIDE, hipsR: [6, hy, 0], spine: [8, hy * 0.25, 0], chest: [4, hy * 0.35, 0], head: [0, 0, 0],
  spear: [hy > 0 ? 0.08 : -0.3, 1.1, 0.26, sy, -4, 0], gripL: 0.44, ...extra });
const SLAM = { hips: [0, 0.6, 0.22], hipsR: [30, -12, 0], spine: [16, 0, 0], chest: [12, 0, 0], head: [-6, 0, 0],
  footL: [0.3, 0.08, 0.5, 0, 20], footR: [-0.3, 0.1, -0.4, 30, -40], spear: spearAbout([-0.02, 0.62, 0.9], 0, -58, 90, 0.55), gripR: 0.2, gripL: 0.62 };
// sprint with the spear couched like a lance (one loop = one stride)
const runKey = (u) => {
  const ph = u * Math.PI * 2, s = Math.sin(ph);
  const foot = (x, o) => { const sp = Math.sin(ph + o), cp = Math.cos(ph + o); return [x, 0.08 + Math.max(0, cp) * 0.3, sp * 0.62 + 0.06, -cp * 30, 0]; };
  return [u, P({ ...CHARGE, hips: [0, 0.8 + Math.abs(Math.cos(ph)) * 0.05, 0.1], hipsR: [24, -30 + s * 8, 0], chest: [4, -8 - s * 10, 0],
    footL: foot(0.12, 0), footR: foot(-0.12, Math.PI), spear: [-0.2, 1.02 - s * 0.03, -0.08, 5, -3, 90] }), 'lin'];
};
Object.assign(CLIPS, {
  // DW8 activation: spear planted upright in the right hand, left arm thrown out, chin up at the camera
  mu_act: clip([
    [0, P()],
    [0.35, P(RAISE), 'out'],
    [1, P({ ...RAISE, hips: [0, 0.93, 0], chest: [-7, -4, 0], spear: spearAbout([-0.36, 1.62, 0.18], 4, 87, 0, 0.9), armL: [-35, 0, 62, 20] })],
  ]),
  mu_face: clip([[0, P(FACE)], [0.5, P({ ...FACE, chest: [-2, -9, 0], spear: spearAbout([0.02, 1.4, 0.3], 60, 55, 0, 0.9) })], [1, P(FACE)]]),
  mu_charge: clip([[0, P(FACE)], [1, P(CHARGE), 'out']]),
  mu_run: clip([0, 0.25, 0.5, 0.75, 1].map(runKey), true),
  // contact thrust → sweep → backhand → full spin → spear overhead for the slam
  mu_rush: clip([
    [0, P(CHARGE)],
    [0.1, P(THRUST), 'snap'],
    [0.3, P(SWEEP(-60, -110)), 'in'],
    [0.46, P(SWEEP(40, 100)), 'out'],
    [0.62, P({ ...SWEEP(10, 88), spin: 180 }), 'in'],
    [0.8, P({ ...SWEEP(10, 88), spin: 360 }), 'out'],
    [1, P({ ...OVERHEAD, spin: 360 })],
  ]),
  mu_fin: clip([
    [0, P(OVERHEAD)],
    [0.1, P(SLAM), 'snap'],
    [0.62, P({ ...SLAM, hips: [0, 0.64, 0.2], chest: [10, 0, 0] })],
    [1, P(), 'io'],
  ]),
});

const DT = 1 / 60;
const easeOut = (u) => 1 - (1 - u) * (1 - u);
const smooth = (u) => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); };
// Chase/payoff cameras never look into the low sun (backlit crowd + haze = an unreadable payoff): the view yaw keeps at
// least SUN_AVOID from the sun's azimuth, and the payoff swings to the side of the rush that faces away from it.
const SUN_AZ = Math.atan2(SUN_DIR.x, SUN_DIR.z), SUN_AVOID = 1.05;
const offSun = (y) => { const d = wrap(y - SUN_AZ); return Math.abs(d) >= SUN_AVOID ? y : SUN_AZ + (d < 0 ? -1 : 1) * SUN_AVOID; };
const PAYOFF_YAW = 1.15;                                   // payoff camera: this far round from the rush direction (rad)

export function createMusou(game) {
  const mu = { active: false, t: 0, wasReady: false, yaw0: 0, ax: 0, az: 0, ayaw: 0, side: 1, waveR: 0, seq: 0 };
  const shot = { id: 0, yaw: 0, dist: 0, pitch: 0, fov: 50, height: 1.2, side: 0, shake: 1 };
  const push = [];                                           // [i, fromX, fromZ, toX, toZ] aura displacement
  let startMusou = 0;

  mu.reset = () => { mu.active = false; mu.t = 0; mu.wasReady = false; mu.waveR = 0; mu.side = 1; push.length = 0; };

  /** Contact frame → world. `side` mirrors left/right so the dragon's broadside sweep runs on the far side of the
   *  payoff camera (side +1: camera behind-right of the rush, −1: behind-left). */
  mu.toWorld = (p, out) => {
    const s = Math.sin(mu.ayaw), c = Math.cos(mu.ayaw), l = p[0] * mu.side;
    out[0] = mu.ax + l * c + p[2] * s; out[1] = p[1]; out[2] = mu.az - l * s + p[2] * c;
    return out;
  };

  mu.start = (inp) => {
    const h = game.hero, c = game.crowd;
    const [sx, sz, smag] = stickDir(inp, game.cam.yaw);           // held stick aims the Musou (else: current facing)
    if (smag) h.yaw = Math.atan2(sx, sz);
    mu.active = true; mu.t = 0; mu.waveR = 0; mu.seq++;
    mu.yaw0 = mu.ayaw = h.yaw; mu.ax = h.x; mu.az = h.z;
    startMusou = h.musou;
    h.move = null; h.vx = h.vz = 0;
    setState(h, 'musou');
    h.musouClip = 'mu_act'; h.musouT = 0;
    h.iframes = MUSOU.end + 30;
    game.freeze = 2;
    // activation aura: grounded soldiers inside r0/(1-k) recoil outward (frozen mid-stagger until contact)
    const { r0, k } = MUSOU.aura, R1 = r0 / (1 - k);
    push.length = 0;
    for (let i = 0; i < c.N; i++) {
      const s = c.st[i];
      if (s === ST.OFF || s === ST.DEAD || c.y[i] > 0.3) continue;
      const dx = c.x[i] - h.x, dz = c.z[i] - h.z, d = Math.hypot(dx, dz);
      if (d >= R1 || d < 1e-3) continue;
      const f = (r0 + d * k) / d;
      push.push([i, c.x[i], c.z[i], h.x + dx * f, h.z + dz * f]);
      c.releaseToken(i);
      c.st[i] = ST.KNOCK; c.stT[i] = 0; c.vx[i] = c.vz[i] = 0;
    }
    emit('musou:start', { x: h.x, z: h.z, activation: MUSOU.closeup, burstAt: MUSOU.finisher, contact: MUSOU.contact });
  };

  // hit-window keys are negative (hero moves use ≥ 0) and unique per activation (enemies remember their last key)
  const hitAt = (hit, x, z, yaw, key, rehit) => game.combat.strike(hit, x, z, yaw, key - (mu.seq % 1000) * 100000, rehit, 'musou');
  const P3 = [0, 0, 0], W3 = [0, 0, 0];

  /** Runs in place of combo/locomotion while the hero is in the 'musou' state. */
  mu.stepHero = (inp) => {
    const h = game.hero, c = game.crowd, t = ++mu.t, M = MUSOU;
    h.iframes = Math.max(h.iframes, 2);
    h.vx = h.vz = 0;
    h.musou = Math.max(0, startMusou - h.musouMax * M.cost * Math.min(1, t / M.contact));   // one segment drains by contact
    if (t < M.contact) game.freeze = Math.max(game.freeze, 2);          // world holds still until contact
    if (t <= M.aura.frames) {                                            // aura shove (eased), then hold
      const u = easeOut(t / M.aura.frames);
      for (const [i, fx, fz, tx, tz] of push) if (c.st[i] === ST.KNOCK) { c.x[i] = fx + (tx - fx) * u; c.z[i] = fz + (tz - fz) * u; }
    }
    if (t < M.closeup) { h.musouClip = 'mu_act'; h.musouT = t / M.closeup; return; }
    if (t < M.pullback) { h.musouClip = 'mu_face'; h.musouT = (t - M.closeup) / (M.pullback - M.closeup); return; }
    if (t < M.chase) { h.musouClip = 'mu_charge'; h.musouT = (t - M.pullback) / (M.chase - M.pullback); return; }
    if (t < M.contact) {                                                 // chase run: sprint, steerable
      const [dx, dz, mag] = stickDir(inp, mu.yaw0);                    // stick is relative to the chase view (behind the rush)
      if (mag) turnToward(h, Math.atan2(dx, dz), M.chaseTurn * DT);
      const v = M.chaseSpeed * Math.min(1, (t - M.chase) / 6);
      h.x += Math.sin(h.yaw) * v * DT; h.z += Math.cos(h.yaw) * v * DT;
      h.musouClip = 'mu_run'; h.musouT = (t - M.chase) / 17;
      return;
    }
    if (t === M.contact) {                                               // CONTACT: blast + the dragon is released
      mu.ax = h.x; mu.az = h.z; mu.ayaw = h.yaw;
      // payoff camera side: whichever side of the rush looks further away from the sun (front-lit launch fan)
      mu.side = Math.abs(wrap(h.yaw + PAYOFF_YAW - SUN_AZ)) >= Math.abs(wrap(h.yaw - PAYOFF_YAW - SUN_AZ)) ? 1 : -1;
      hitAt(M.contactHit, h.x, h.z, h.yaw, -2000, false); hitAt(M.backHit, h.x, h.z, h.yaw, -2000, false);
      emit('musou:hit', { x: h.x + Math.sin(h.yaw) * 2.5, y: 1.3, z: h.z + Math.cos(h.yaw) * 2.5, stage: 'contact', yaw: h.yaw, n: 0 });
    }
    const k0 = t - M.contact, F = M.front;
    if (k0 > 0 && k0 <= F.frames && k0 % 2 === 0) {                    // expanding launch front (same key: each body once)
      const r = F.r0 + (F.r1 - F.r0) * easeOut(k0 / F.frames);
      const n = hitAt({ ...M.contactHit, range: r, ang: F.ang, hitstop: 0, force: 5.5 + r * 0.2, lift: 7.4 + r * 0.12 }, mu.ax, mu.az, mu.ayaw, -2000, false);
      if (n) emit('musou:hit', { x: mu.ax + Math.sin(mu.ayaw) * r * 0.8, y: 1.2, z: mu.az + Math.cos(mu.ayaw) * r * 0.8, stage: 'front', yaw: mu.ayaw, n: k0 });
    }
    const s = (t - M.contact) / 60;                                     // seconds after contact
    // hero drives forward behind the dragon (along the contact facing, so the dragon's path stays anchored)
    const d = M.rushDist * easeOut(Math.min(1, s / 0.6));
    h.x = mu.ax + Math.sin(mu.ayaw) * d; h.z = mu.az + Math.cos(mu.ayaw) * d; h.yaw = mu.ayaw;
    if (t < M.finisher) {
      h.musouClip = 'mu_rush'; h.musouT = (t - M.contact) / (M.finisher - M.contact);
      mu.toWorld(dragonAt(dragonArc(s), P3), W3);
      if (k0 > 0 && k0 % 2 === 0 && W3[1] < 4.2) {                        // the dragon tears through the crowd
        hitAt(M.dragonHit, W3[0], W3[2], mu.ayaw, -2100 - t, true);
        emit('musou:hit', { x: W3[0], y: W3[1], z: W3[2], stage: 'dragon', yaw: mu.ayaw, n: k0 });
      }
      if (k0 > 0 && k0 % 3 === 0) {                                      // Zhao Yun's own sweeps around him
        hitAt(M.heroHit, h.x, h.z, h.yaw, -2200 - t, true);
        emit('musou:hit', { x: h.x, y: 1.1, z: h.z, stage: 'rush', yaw: h.yaw, n: k0 });
      }
      return;
    }
    h.musouClip = 'mu_fin'; h.musouT = (t - M.finisher) / (M.end - M.finisher);
    const w = t - M.finisher;
    if (w <= M.waveFrames) {                                             // FINISHER: ring wave, tiers of launched bodies
      const u = w / M.waveFrames;
      mu.waveR = M.waveR * (1 - (1 - u) * (1 - u) * (1 - u)) + 1;
      // heavy (officers fly too) only on the first ticks: every heavy tick also costs a vfx dust puff + camera kick
      const hit = { ...M.waveHit, range: mu.waveR, lift: M.waveHit.lift - 4 * u, hitstop: w === 0 ? 4 : 0, heavy: w < 2 };
      const n = hitAt(hit, h.x, h.z, h.yaw, -3000, false);
      if (w === 0) emit('musou:burst', { count: n, x: h.x, z: h.z });
      else if (n) {                                                      // report the tick on the wave front (sparks ride the ring)
        const a = w * 2.4, R = mu.waveR * 0.9;
        emit('musou:hit', { x: h.x + Math.sin(a) * R, y: 0.4, z: h.z + Math.cos(a) * R, stage: 'wave', yaw: a, n: w });
      }
    }
    if (t >= M.end) {
      mu.active = false;
      h.musou = Math.max(0, startMusou - h.musouMax * M.cost);
      h.iframes = 30;
      setState(h, 'idle');
      emit('musou:end', {});
    }
  };

  /**
   * Camera shot for the current musou frame (render side reads it; pure of sim state). id changes = hard cut.
   * yaw/dist/pitch/height as in the camera rig (target = hero + height, camera `dist` back along yaw at `pitch`),
   * side = target offset to screen-right (m), shake = multiplier on event shake.
   */
  mu.shot = () => {
    if (!mu.active) return null;
    const t = mu.t, M = MUSOU, h = game.hero, o = shot;
    o.shake = 0.3; o.side = 0;
    // r3: the intro shots look DOWN onto the cobbles and the frozen crowd (DW8 anchor-activation-pose), never up into the
    // hazy sunlit sky: the old low, level pose (pitch -0.07) was 2.1× gameplay luma before the dim, so the intro never
    // went dark and the payoff had nothing to release from. Yaws stay off the sun's azimuth.
    if (t < M.closeup) {                                   // front three-quarter from above head height, slow push-in
      const u = t / M.closeup;
      Object.assign(o, { id: 1, yaw: offSun(mu.yaw0 + Math.PI * 0.8), dist: 4.1 - 0.6 * u, pitch: 0.36, fov: 46, height: 1.0, side: 0.1 });
    } else if (t < M.chase) {                              // head-and-shoulders cut-in (slightly from above), then pull back
      const u = Math.min(1, (t - M.closeup) / (M.pullback - M.closeup)), v = Math.max(0, (t - M.pullback) / (M.chase - M.pullback));
      Object.assign(o, { id: 2, yaw: offSun(mu.yaw0 + Math.PI * 0.88), dist: 1.85 - 0.25 * smooth(u) + 1.8 * v * v, pitch: 0.16 + 0.12 * v, fov: 32 + 10 * v,
        height: 1.52 - 0.3 * v, side: -0.16 * (1 - v) });
    } else if (t < M.contact) {                            // low chase camera behind him (never into the sun)
      Object.assign(o, { id: 3, yaw: h.yaw, dist: 2.7, pitch: 0.08, fov: 54, height: 0.95 });
    } else if (t >= M.finisher - 10) {
      // r3 finisher: cut (as the dragon rears for its dive) to a low wide shot from behind him (DW9 ring-wave framing:
      // hero ≈ 20 % of frame height, the launched tiers stacked against the sky, the dive onto him and the coil in full
      // view). The old flank camera had the dive + coil 4–6 m from the lens and the wave dust between, a teal fog with
      // no hero in it. It is also the gameplay side of him, so the blend back to control is short.
      const u = smooth((t - M.finisher + 10) / (M.end - M.finisher + 10));
      Object.assign(o, { id: 4, yaw: offSun(mu.ayaw + mu.side * 0.32), dist: 8.2 + 1.3 * u, pitch: -0.03 + 0.07 * u, fov: 58 - 4 * u,
        height: 1.5 + 0.3 * u, side: 0, shake: 0.6 });
    } else {
      // payoff: whip round to the sun-side-away flank of the rush (≈66° off the rush line), low, so the launch fan
      // crosses the frame front-lit and the dragon's sweep runs broadside on the far side; hold that while the bodies
      // fly, then ease back, still low, for the finisher: the ring wave throws its tiers against the sky and the dragon
      // coils up around him
      const c = t - M.contact, w = easeOut(Math.min(1, c / 9)), k = smooth((c - 34) / 22);
      const sw = mu.side * PAYOFF_YAW * w;
      Object.assign(o, { id: 3, yaw: offSun(mu.ayaw + sw * (1 - 0.2 * k)),
        dist: 2.7 + 2.5 * w + 0.5 * Math.min(1, c / 40) + 3.0 * k, pitch: 0.08 - 0.05 * w + 0.12 * k,
        fov: 54 + 6 * w, height: 0.95 + 0.15 * w + 0.5 * k, side: mu.side * 1.5 * w * (1 - 0.8 * k), shake: 0.5 });
    }
    return o;
  };

  /** At least one full gauge segment (hero.js asks before starting a Musou). */
  mu.ready = () => game.hero.musou >= game.hero.musouMax * MUSOU.cost - 1e-6;
  /** Gauge-ready notification (edge-triggered). */
  mu.step = () => {
    const ready = mu.ready() && game.hero.state !== 'musou';
    if (ready && !mu.wasReady) emit('musou:ready', {});
    mu.wasReady = ready;
  };
  return mu;
}
