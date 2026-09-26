// Attack pose clips, one per move id in moves.js, sampled by normalised move time (moveT / frames).
// Authoring: P(spec) overrides STANCE (angles in degrees, positions in root space, hero faces +Z, left = +X).
// spear: [x,y,z (rear-grip origin = right hand), yaw (0 fwd, +90 left), elev (+ up, >90 = back over head), roll].
// roll 0 = blade flat (horizontal sweeps), 90 = blade edge vertical (chops, thrusts).
//
// Keys are authored in SIM FRAMES of the move (clipF) and anchored to the move's hit window / cancel frame from moves.js,
// so a retimed move keeps its strike inside its active frames.
//
// FEET (r2): `fL` / `fR` = [x, y, z, pitch, yaw] are GROUND SPOTS in move-start coordinates — the hero-facing frame at the
// start of the move, before its lunge, NOT turned by `spin`. Each foot is its own track keyed wherever a key gives it
// (`ft()` keys carry only feet). The tracks are then baked per sim frame (plantFoot): a grounded foot (y < 0.12) holds its
// spot exactly while the lunge carries the root and `spin` turns the body over it, and any authored slide of a grounded
// foot becomes a lifted step. The pose's `plant` channel = 1 tells the rig the feet are in the hero-facing frame. Every
// clip starts on the feet the previous move of its string left at its cancel frame (ENTRY), so strings never re-stance.
import { P, clip, sampleClip, spearAbout, STANCE, CH, POSE_SIZE } from '../rig.js';
import { MOVES, lungeAt } from '../moves.js';

const D2R = Math.PI / 180;
const ST = STANCE;
/** Stance feet at the end of move `id` (move-start coords: stance + the move's whole lunge). */
const endFeet = (id) => {
  const d = lungeAt(MOVES[id], MOVES[id].frames), fwd = (v) => v.map((x, i) => (i === 2 ? x + d : x));
  return { fL: fwd(ST.footL), fR: fwd(ST.footR) };
};
/** Foot given root-relative in the BODY frame (stance-like coords) at spin `sp` and move frame f → move-start coords. */
const body = (id, f, sp, v) => {
  const a = sp * D2R, c = Math.cos(a), s = Math.sin(a);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c + lungeAt(MOVES[id], f), v[3] || 0, v[4] + sp];
};
/** A key that carries only feet (either may be null). */
const ft = (f, fL, fR) => [f, { feet: 1, fL, fR }];

// ---------------------------------------------------------------- foot planting (bake)
const CONTACT = 0.12, HOLD = 0.035, STILL = 0.004, STEP_MIN = 3, STEP_MAX = 10;
const hd = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
/**
 * One foot's per-frame track W ([x,y,z,pitch,yaw], move-start coords) → planted track. Airborne frames (y >= CONTACT) are
 * kept as authored. A grounded foot holds its spot until the authored spot drifts > HOLD, then steps there in one lifted
 * arc timed to the authored motion (STEP_MIN..STEP_MAX frames). `busy(f)` = the other foot is off the ground at f: a
 * generated step waits for it (no accidental hops).
 */
function plantFoot(W, busy) {
  const n = W.length, O = W.map((r) => r.slice());
  let anc = null;
  for (let f = 0; f < n;) {
    const w = W[f];
    if (w[1] >= CONTACT) { anc = null; f++; continue; }
    if (!anc || hd(w, anc) <= HOLD || (busy(f) && f < n - STEP_MIN - 1)) {
      anc = anc || w; O[f][0] = anc[0]; O[f][1] = anc[1]; O[f][2] = anc[2]; f++; continue;
    }
    const a = f - 1;
    let g = f;
    while (g - a < STEP_MAX && g + 1 < n && W[g + 1][1] < CONTACT && hd(W[g + 1], W[g]) > STILL) g++;
    g = Math.min(n - 1, Math.max(g, a + STEP_MIN));
    const B = W[g], d = hd(B, anc), lift = Math.min(0.24, Math.max(0.07, 0.45 * d));
    for (let k = f; k <= g; k++) {
      const u = (k - a) / (g - a), s = u * u * (3 - 2 * u), h = 4 * u * (1 - u);
      O[k][0] = anc[0] + (B[0] - anc[0]) * s; O[k][2] = anc[2] + (B[2] - anc[2]) * s;
      O[k][1] = Math.max(W[k][1], anc[1] + (B[1] - anc[1]) * s + lift * h);
      O[k][3] = W[k][3] - 0.3 * h;                              // toe comes up through the swing
    }
    anc = B[1] < CONTACT ? B : null; f = g + 1;
  }
  return O;
}

const BUILT = {};
const ENTRY = { n2: 'n1', n3: 'n2', n4: 'n3', n5: 'n4', n6: 'n5', c2: 'n1', c3: 'n2', c4: 'n3', c5: 'n4', c6: 'n5' };
const fdeg = (v, yaw) => [v[0], v[1], v[2], v[3] || 0, v[4] == null ? yaw : v[4]];
/**
 * Bake the feet of move `id` from keys (fL/fR in move-start coords; frame 0 = `entry` feet or stance, last frame = stance
 * unless keyed) → per-frame table (root-relative, this move's lunge undone) + sampler over normalised move time.
 */
function bakeFeet(id, keys, entry) {
  const F = MOVES[id].frames;
  const tracks = [['fL', CH.footL, ST.footL, 15, 0], ['fR', CH.footR, ST.footR, -30, 1]].map(([k, ch, st, yaw, j]) => {
    const fk = keys.filter(([f, s]) => s[k] && f > 0).map(([f, s]) => [f, fdeg(s[k], yaw)]);
    if (!fk.length || fk[fk.length - 1][0] < F) fk.push([F, fdeg(endFeet(id)[k], yaw)]);
    const tk = [[0, entry ? entry[j] : st], ...fk].map(([f, v]) => [Math.min(1, f / F), P({ [k === 'fL' ? 'footL' : 'footR']: v }), 'lin']);
    const tc = clip(tk, false, true), p = new Float32Array(POSE_SIZE), W = [];
    for (let f = 0; f <= F; f++) { sampleClip(tc, f / F, p); W.push(Array.from(p.subarray(ch, ch + 5))); }
    return W;
  });
  const OL = plantFoot(tracks[0], (f) => tracks[1][f][1] >= CONTACT);
  const OR = plantFoot(tracks[1], (f) => OL[f][1] >= CONTACT);
  // weight: every touchdown sinks the pelvis a few cm for a few frames (scaled by how fast the foot came down)
  const dip = new Float32Array(F + 1), K = [1, 0.75, 0.4, 0.15];
  for (const O of [OL, OR]) for (let f = 1; f <= F; f++) {
    if (O[f - 1][1] < CONTACT || O[f][1] >= CONTACT) continue;
    const v = Math.min(1, (O[f - 1][1] - O[f][1]) / 0.06);
    K.forEach((w, k) => { if (f + k <= F) dip[f + k] = Math.min(dip[f + k], -0.04 * v * w); });
  }
  const tab = new Float32Array((F + 1) * 10);
  [OL, OR].forEach((O, j) => O.forEach((r, f) => { r[2] -= lungeAt(MOVES[id], f); tab.set(r, f * 10 + j * 5); }));
  const feet = (t, out) => {
    const x = Math.min(F, Math.max(0, t * F)), i = Math.min(F - 1, Math.floor(x)), u = x - i;
    for (let j = 0; j < 10; j++) out[CH.footL + j] = tab[i * 10 + j] + (tab[i * 10 + 10 + j] - tab[i * 10 + j]) * u;
    out[CH.hips + 1] += dip[i] + (dip[i + 1] - dip[i]) * u;
    out[CH.plant] = 1;
  };
  const row = (f, j) => { const r = tab.subarray(f * 10 + j * 5, f * 10 + j * 5 + 5); return [r[0], r[1], r[2], r[3] / D2R, r[4] / D2R]; };
  return { feet, exit: [row(MOVES[id].cancel, 0), row(MOVES[id].cancel, 1)] };
}
/** Frame-keyed clip: keys [frame, spec, ease]. Body keys make the pose clip; fL/fR (any key, incl. ft()) make the feet. */
function clipF(id, keys) {
  const F = MOVES[id].frames, prev = BUILT[ENTRY[id]];
  keys = keys.slice().sort((a, b) => a[0] - b[0]);
  const c = clip(keys.filter(([, s]) => !s.feet).map(([f, spec, e]) => [Math.min(1, f / F), P({ ...spec, plant: 1 }), e]), false, true);
  Object.assign(c, bakeFeet(id, keys, prev && prev.exit));
  BUILT[id] = c;
  return c;
}
const hit = (id, i = 0) => MOVES[id].hits[i].f;
/** Walking step keys: each [side, f0, f1, x, z, yaw] lifts that foot (by `lift`, toe `pitch`°) from its spot in `pos`
 *  (updated) to (x, z). */
const stepKeys = (steps, pos, lift, pitch) => steps.flatMap(([side, a, b, x, z, yaw]) => {
  const p = pos[side], k = side === 'L' ? 'fL' : 'fR';
  pos[side] = [x, z];
  return [[a, { feet: 1, [k]: [p[0], 0.08, p[1], 0, yaw] }], [(a + b) / 2, { feet: 1, [k]: [(p[0] + x) / 2, lift, (p[1] + z) / 2, pitch, yaw] }],
    [b, { feet: 1, [k]: [x, 0.08, z, 0, yaw] }]];
});
/** Stance with the spear yaw/elev offset by whole turns, so a clip that spun the spear ends without unwinding it. */
const stTurn = (yawTurns, elevTurns, extra) => ({ ...ST, spear: [...ST.spear.slice(0, 3), ST.spear[3] + 360 * yawTurns, ST.spear[4] + 360 * elevTurns, 0], ...extra });

const K = (t, spec, e) => [t, P(spec), e];
const LUNGE = { hips: [0, 0.8, 0.2], footL: [0.2, 0.08, 0.66, 0, 10], footR: [-0.24, 0.08, -0.36, 0, -60] };
const END = [1, P()];

// thrust pose helper: spear straight ahead at waist height, tip a little down, body side-on, front hand sliding back
// toward the rear hand
const thrust = (z, extra) => ({
  ...LUNGE, hipsR: [4, -70, 0], spine: [6, -8, 0], chest: [2, -6, 0], head: [0, 0, 0],
  spear: [-0.2, 1.1, z, 0, -4, 90], gripL: 0.32, ...extra,
});
// spear held out to the left side (for spin sweeps), body squared
const SIDE = { hipsR: [4, 10, 0], spine: [6, 10, 0], chest: [2, 10, 0], head: [0, 0, 0], spear: [-0.02, 1.08, 0.32, 88, -4, 0], gripL: 0.38 };

// ---------------------------------------------------------------- normal string (benchmark: DW8XL Zhao Yun □×6)
// N1 overhead diagonal chop · N2 step-in rising upswing (knee lift) · N3 flat low sweep with torso twist · N4 run-in with
// the spear carried overhead, shoulder-high sweep · N5 over-shoulder chop into a front twirl, pivot on the lead foot ·
// N6 hop-lunge thrust, overhead whip into a 360° spin sweep pivoting on the lead foot, held low finish.
function n1() {
  const [s, e] = hit('n1'), F = MOVES.n1.frames, c = MOVES.n1.cancel;
  const coil = { hips: [0, 0.9, -0.03], hipsR: [-2, 12, 0], spine: [-4, 10, 0], chest: [-8, 16, 6], head: [0, 6, 0] };
  const end = { hips: [0, 0.78, 0.08], hipsR: [14, -30, 0], spine: [8, -8, 0], chest: [10, -12, -6], head: [10, -12, 0] };
  const fin = { ...end, hips: [0, 0.8, 0.06], chest: [8, -14, -4], spear: [-0.22, 0.98, 0.32, -30, -18, 90], gripL: 0.52 };
  const FL = [0.24, 0.08, 0.84, 0, 20];
  return clipF('n1', [
    [0, { ...ST }],
    [s - 5, { ...coil, spear: [-0.14, 1.6, -0.04, -24, 148, 90], gripL: 0.4, fL: [0.18, 0.2, 0.44, -12] }, 'out'],   // lift into the chamber
    [s - 3, { ...coil, chest: [-10, 20, 8], spear: [-0.12, 1.64, -0.08, -24, 156, 90], gripL: 0.4,
      fL: [0.2, 0.18, 0.64, -12] }, 'io'],                                                           // held chamber, lead knee up
    [s - 1, { hips: [0, 0.88, 0], hipsR: [2, 4, 0], spine: [0, 4, 0], chest: [-2, 6, 4], head: [0, 2, 0],
      spear: [-0.12, 1.64, 0.1, -24, 100, 90], gripL: 0.44, fL: FL, fR: ST.footR }, 'lin'],             // over the top, foot lands
    [s, { hips: [0, 0.84, 0.04], hipsR: [8, -12, 0], spine: [4, -2, 0], chest: [4, -4, -2], head: [4, -4, 0],
      spear: [-0.14, 1.34, 0.3, -23, 12, 90], gripL: 0.48 }, 'lin'],                                 // contact: blade level at the victims
    [s + 2, { hips: [0, 0.8, 0.07], hipsR: [12, -24, 0], spine: [7, -6, 0], chest: [8, -9, -4], head: [8, -9, 0],
      spear: [-0.18, 1.12, 0.36, -22, -8, 90], gripL: 0.5, fR: [-0.2, 0.1, -0.26, 16, -30] }, 'lin'],
    [e + 2, { ...end, spear: [-0.2, 1.0, 0.36, -22, -14, 90], gripL: 0.52, fR: [-0.2, 0.1, -0.26, 16, -40] }, 'out'],   // low front-right
    [e + 5, { ...fin }, 'io'],
    ft(e + 6, null, [-0.2, 0.08, -0.26, 0, -40]),
    ft(e + 9, null, [-0.22, 0.08, 0.04, 0, -40]),                                                    // rear foot follows up
    [c, { ...fin, hips: [0, 0.8, 0.05] }, 'io'],
    ft(c, FL, null),
    [F, { ...ST }],
  ]);
}
function n2() {
  const [s, e] = hit('n2'), F = MOVES.n2.frames, c = MOVES.n2.cancel;
  const top = { hips: [0, 0.94, 0.34], hipsR: [-8, 24, 0], spine: [-6, 12, 0], chest: [-8, 16, 0], head: [-12, 14, 0] };
  const flick = { hips: [0, 0.78, 0.2], hipsR: [12, -46, 0], spine: [6, -12, 0], chest: [6, -16, 0], head: [4, -6, 0] };
  const L0 = BUILT.n1.exit[0], FRs = [-0.22, 0.08, 0.74, 0, -20];
  return clipF('n2', [
    [0, { ...ST }],
    ft(1, null, [-0.2, 0.1, -0.2, 20, -30]),
    [s - 6, { hips: [0, 0.8, 0.06], hipsR: [10, -40, 0], spine: [6, -10, 0], chest: [6, -14, 0], head: [4, -4, 0],
      spear: [-0.26, 0.94, 0.12, -55, -10, 0], gripL: 0.34 }, 'out'],                                // step in
    ft(2.5, null, [-0.2, 0.26, 0.24, -20, -25]),
    [s - 4, { ...flick, spear: [-0.24, 0.92, 0.14, -84, -14, 0], gripL: 0.3, fR: FRs }, 'io'],                        // flick right, plant
    [s - 2, { ...flick, hipsR: [14, -50, 0], chest: [7, -19, 0], spear: [-0.25, 0.9, 0.1, -92, -15, 0], gripL: 0.3 }, 'io'],   // held
    [s - 1, { hips: [0, 0.82, 0.26], hipsR: [6, -24, 0], spine: [2, -4, 0], chest: [2, -6, 0], head: [0, -4, 0],
      spear: [-0.2, 0.98, 0.3, -34, 4, 30], gripL: 0.36, fL: [L0[0], 0.08, L0[2], 0, 15] }, 'lin'],
    [s + 1, { hips: [0, 0.9, 0.34], hipsR: [-2, 4, 0], spine: [-2, 4, 0], chest: [-4, 6, 0], head: [-6, 6, 0],
      spear: [-0.08, 1.18, 0.38, 28, 32, 45], gripL: 0.4, fL: [0.19, 0.22, 0.66, -20, 10] }, 'lin'],
    [e + 2, { ...top, spear: [0.06, 1.38, 0.46, 70, 50, 45], gripL: 0.4, fL: [0.16, 0.46, 0.9, -30, 10] }, 'out'],   // top-left, knee up
    [e + 5, { ...top, hips: [0, 0.93, 0.34], spear: [0.08, 1.4, 0.44, 74, 54, 45], gripL: 0.4, fL: [0.16, 0.42, 0.94, -30, 10] }, 'io'],
    [c, { ...top, hips: [0, 0.86, 0.36], hipsR: [4, 16, 0], spear: [0.06, 1.3, 0.44, 66, 46, 45], gripL: 0.4,
      fL: [0.2, 0.08, 1.34, 0, 15], fR: FRs }, 'out'],                                               // foot comes down forward
    [F, { ...ST }],
  ]);
}
function n3() {
  const [s, e] = hit('n3'), F = MOVES.n3.frames, c = MOVES.n3.cancel;
  const tw = (y, extra) => ({ hips: [0, 0.78, 0.04], hipsR: [8, y, 0], spine: [6, y * 0.3, 0], chest: [4, y * 0.4, 0], head: [4, y * 0.4, 0], ...extra });
  const R0 = BUILT.n2.exit[1], FL = [0.3, 0.08, 0.92, 0, 25];
  const fin = { ...tw(44), hips: [0, 0.8, 0.08], spear: [0.14, 1.02, 0.26, 112, -3, 0], gripL: 0.42 };
  return clipF('n3', [
    [0, { ...ST }],
    [s - 5, { ...tw(-55), spear: [-0.32, 0.94, 0.2, -92, -6, 0], gripL: 0.42, fR: [R0[0], 0.08, R0[2], 0, -60] }, 'out'],   // chamber at the right hip
    ft(s - 5, BUILT.n2.exit[0], null),
    [s - 3, { ...tw(-62), spear: [-0.34, 0.92, 0.18, -104, -8, 0], gripL: 0.42, fL: [0.28, 0.18, 0.58, -12, 25] }, 'io'],
    [s - 1, { ...tw(-30), hips: [0, 0.76, 0.1], spear: [-0.3, 0.92, 0.22, -48, -14, 0], gripL: 0.42, fL: FL }, 'lin'],     // lunge step lands
    [s + 1, { ...tw(5), hips: [0, 0.76, 0.1], spear: [-0.12, 0.94, 0.34, 26, -12, 0], gripL: 0.42,
      fR: [R0[0], 0.1, R0[2], 18, -50] }, 'lin'],                                                    // rear heel peels as the hips turn
    [e + 2, { ...tw(40), hips: [0, 0.78, 0.1], spear: [0.12, 1.0, 0.3, 104, -5, 0], gripL: 0.42 }, 'out'],                 // far left
    ft(e + 3, null, [R0[0], 0.1, R0[2], 18, -45]),
    ft(e + 6, null, [-0.26, 0.08, 0.14, 0, -40]),                                                    // rear foot drags up
    [e + 5, { ...fin }, 'io'],
    [c, { ...fin, hips: [0, 0.8, 0.07] }, 'io'],
    ft(c, FL, null),
    [F, { ...ST }],
  ]);
}
function n4() {
  // One continuous counter-clockwise circle of the spear: carried level overhead pointing left during the run-in,
  // swung round behind the head (the "rotate" beat), then a one-handed shoulder-high sweep right → left.
  const [s, e] = hit('n4'), F = MOVES.n4.frames, c = MOVES.n4.cancel;
  const run = { hipsR: [12, -8, 0], spine: [2, 0, 0], chest: [-2, 4, 0], head: [-4, 0, 0] };
  const sw = (y, extra) => ({ hips: [0, 0.8, 0.12], hipsR: [6, y * 0.5, 0], spine: [4, y * 0.3, 0], chest: [2, y * 0.5, 0], head: [0, y * 0.4, 0],
    gripL: 0.5, lfree: 1, armL: [40, 0, 70, 10], ...extra });
  const [L0, R0] = BUILT.n3.exit, FL = [0.22, 0.08, 1.82, 0, 20], FR = [-0.18, 0.08, 0.82, 0, -10];
  const hold = { ...sw(50), hips: [0, 0.84, 0.08], spear: [0.32, 1.3, 0.18, 476, 4, 0], lfree: 0.5, armL: [30, 0, 50, 30] };
  // one-handed sweep: the hand slides to the butt end (same hand spot, shaft reaches k further out, butt clears the head)
  const endGrip = (sp, k) => { const y = sp[3] * Math.PI / 180, e = sp[4] * Math.PI / 180;
    return { spear: [sp[0] + Math.sin(y) * Math.cos(e) * k, sp[1] + Math.sin(e) * k, sp[2] + Math.cos(y) * Math.cos(e) * k, sp[3], sp[4], sp[5]], gripR: -k }; };
  return clipF('n4', [
    [0, { ...ST }],
    ft(1, null, [R0[0], 0.12, R0[2] + 0.02, 20, -20]),
    [2, { ...run, hips: [0, 0.9, 0.04], spear: [-0.24, 1.8, 0.02, 94, 3, 0], gripL: 0.52 }, 'out'],
    ft(2.4, null, [-0.17, 0.3, 0.26, -30, -10]),
    [s - 10, { ...run, hips: [0, 0.86, 0.06], spear: [-0.24, 1.84, 0.02, 96, 3, 0], gripL: 0.52, fR: FR,
      fL: [L0[0], 0.12, L0[2] + 0.02, 22, 15] }, 'io'],                                              // spear level overhead, stride
    [s - 7, { ...run, hips: [0, 0.84, 0.1], spear: [-0.22, 1.84, 0.04, 104, 3, 0], gripL: 0.52,
      fL: [0.2, 0.3, 1.3, -30, 5] }, 'io'],                                                          // second stride
    [s - 5, { ...run, hips: [0, 0.82, 0.12], chest: [-4, -20, 0], head: [-4, -10, 0], spear: [-0.3, 1.74, 0.0, 190, 4, 0], gripL: 0.5,
      lfree: 0.6, armL: [0, 0, 60, 30], fL: FL }, 'lin'],                                            // round behind the head, lead foot lands
    [s - 3, { ...sw(-34), hips: [0, 0.8, 0.12], ...endGrip([-0.44, 1.4, 0.14, 262, 3, 0], 0.3) }, 'lin'],     // pointing right: sweep starts
    [s - 1, { ...sw(-6), ...endGrip([-0.26, 1.32, 0.5, 318, 2, 0], 0.5) }, 'lin'],
    [s + 1, { ...sw(24), ...endGrip([0.18, 1.32, 0.54, 390, 2, 0], 0.5) }, 'lin'],
    [s + 4, { ...sw(56), hips: [0, 0.82, 0.1], ...endGrip([0.42, 1.34, 0.16, 470, 6, 0], 0.4), armL: [50, 0, 70, 10],
      fR: [FR[0], 0.1, FR[2], 16, -40] }, 'out'],                                                    // end left, arm flung back, heel up
    [e + 2, hold, 'io'],
    [c, { ...hold, hips: [0, 0.84, 0.07] }, 'io'],
    ft(c, FL, [FR[0], 0.08, FR[2], 0, -40]),
    [F, stTurn(1, 0)],
  ]);
}
function n5() {
  const [s1, e1] = hit('n5', 0), [s2, e2] = hit('n5', 1), F = MOVES.n5.frames, c = MOVES.n5.cancel;
  const tw = (f, a, extra) => [f, { hips: [0, 0.84, 0.06], hipsR: [6, -20, 0], spine: [4, -6, 0], chest: [2, -8, 0], head: [0, -6, 0],
    spear: spearAbout([-0.08, 1.34, 0.5], 90, a, 0, 0.62), gripR: 0.62, gripL: 0.62, lfree: 1, armL: [10, 0, 70, 20], ...extra }, 'lin'];
  const whip = { hips: [0, 0.8, 0.04], hipsR: [8, -40, 0], spine: [6, -10, 0], chest: [4, -10, 0], head: [0, -10, 0],
    spear: spearAbout([-0.3, 1.0, 0.16], 30, 358, 0, 0.62), gripR: 0.62, gripL: 0.9 };
  const [L0, R0] = BUILT.n4.exit, PV = [0.06, 0.08, 0.66];                      // pivot spot of the lead foot
  const pv = (f, yaw) => ft(f, [...PV, 0, yaw], null);
  // spin: 0 → -100 at e2+1, -170 at the cancel (N6 carries on from -180), -360 by the end when the string stops here
  const rf = (f, sp, v) => ft(f, null, body('n5', f, sp, v));
  return clipF('n5', [
    [0, { ...ST }],
    [s1 - 5, { hips: [0, 0.88, -0.02], hipsR: [0, -35, 0], spine: [-2, -10, 0], chest: [-6, -22, 0], head: [0, -6, 0],
      spear: [-0.26, 1.52, 0.1, -12, 152, 90], gripL: -0.34, fL: [L0[0] - 0.06, 0.16, L0[2] + 0.08, -10, 15] }, 'out'],   // over the right shoulder
    [s1 - 3, { hips: [0, 0.88, -0.02], hipsR: [0, -38, 0], spine: [-2, -10, 0], chest: [-8, -26, 0], head: [0, -8, 0],
      spear: [-0.26, 1.56, 0.06, -12, 160, 90], gripL: -0.34, fL: [0.1, 0.16, 0.6, -10, 15] }, 'io'],
    [s1 - 1, { hips: [0, 0.86, 0.02], hipsR: [4, -32, 0], spine: [2, -8, 0], chest: [0, -16, 0], head: [2, -6, 0],
      spear: [-0.22, 1.54, 0.2, -10, 100, 90], gripL: -0.34 }, 'lin'],                               // over the top
    [s1, { hips: [0, 0.82, 0.08], hipsR: [8, -26, 0], spine: [6, -6, 0], chest: [6, -8, 0], head: [6, -6, 0],
      spear: [-0.2, 1.3, 0.34, -10, 12, 90], gripL: -0.34, fL: [...PV, 0, 15] }, 'lin'],             // chop lands on the victims, lead foot on the pivot
    ft(s1 - 1, null, [R0[0], 0.08, R0[2], 0, -30]),
    ft(s1 + 2, null, [-0.24, 0.2, -0.24, -10, -30]),
    [e1 + 1, { hips: [0, 0.8, 0.12], hipsR: [12, -20, 0], spine: [8, -4, 0], chest: [10, -6, 0], head: [8, -6, 0],
      spear: spearAbout([-0.24, 1.2, 0.5], -10, -20, 90, 0.3), gripR: 0.3, gripL: 0, fR: [-0.26, 0.08, -0.1, 0, -30] }, 'out'],   // swung down in front
    tw(e1 + 2, 40, {}),                                                                              // flipped vertical in front…
    tw(s2 - 2, 150, { spin: -20 }),
    tw(s2 - 1, 260, { spin: -50 }),                                                                  // …twirled once…
    [s2, { hips: [0, 0.8, 0.1], hipsR: [8, -30, 0], spine: [6, -8, 0], chest: [4, -8, 0], head: [0, -8, 0], spin: -85,
      spear: spearAbout([0.15, 1.22, 0.4], 90, 360, 0, 0.1), gripR: 0.1, gripL: 0.4, lfree: 1, armL: [10, 0, 70, 20] }, 'lin'],   // …and whipped out level at the victims
    pv(s2, -70),
    rf(s2 + 1, -90, [-0.24, 0.24, -0.1, -10, -30]),
    [e2 + 1, { ...whip, spin: -100, hipsR: [6, -30, 0], spear: spearAbout([-0.12, 1.26, 0.44], 90, 360, 0, 0.62), lfree: 1, armL: [10, 0, 70, 20] }, 'lin'],
    rf(e2 + 1, -100, [-0.3, 0.08, -0.36, 0, -30]),                                                   // rear foot steps round
    pv(e2 + 1, -85),
    [c, { ...whip, spin: -170 }, 'out'],                                                            // whip round
    pv(c, -155),
    rf(c + 3, -210, [-0.24, 0.22, -0.2, -10, -30]),
    rf(c + 6, -250, [-0.24, 0.08, -0.26, 0, -30]),
    pv(c + 7, -250),
    ft(c + 12, [...PV, 0, -330], null),
    rf(c + 13, -330, [-0.22, 0.2, -0.24, -10, -30]),
    rf(c + 16, -350, [-0.2, 0.08, -0.26, 0, -30]),
    [F, stTurn(0, 1, { spin: -360 })],
    ft(F, [0.17, 0.08, 0.3 + lungeAt(MOVES.n5, F), 0, 15 - 360], body('n5', F, -360, [-0.2, 0.08, -0.26, 0, -30])),
  ]);
}
function n6() {
  const [s, e] = hit('n6'), F = MOVES.n6.frames, c = MOVES.n6.cancel;
  const hop = s - 10, th = s - 6;
  const low = { hips: [0, 0.66, 0.02], hipsR: [12, -48, 0], spine: [8, -10, 0], chest: [6, -12, 0], head: [2, -20, 0] };
  const fin = { ...low, spear: [-0.3, 0.86, 0.12, -14, -4, 0], gripL: 0.52 };
  const spinK = (f, a, yaw, extra) => [f, { ...SIDE, hips: [0, 0.8, 0.04], spin: a, spear: [-0.02, 1.1, 0.3, yaw, -4, 0], gripL: 0.38, ...extra }, 'lin'];
  const PV = [0.1, 0.08, 1.6], FR = [-0.3, 0.08, 0.9, 0, -420], FL = [0.14, 0.08, 1.9, 0, -350];   // lunge feet, lead-foot pivot
  const rf = (f, sp) => ft(f, null, body('n6', f, sp, [-0.24, 0.26, -0.3, -20, -30]));
  return clipF('n6', [
    [0, { ...ST, spin: -180, spear: spearAbout([-0.3, 1.0, 0.16], -12, -2, 0, 0.62), gripR: 0.62, gripL: 0.9 }],
    [hop - 3, { hips: [0, 0.72, 0], hipsR: [10, -30, 0], spine: [6, -6, 0], chest: [4, -8, 0], head: [0, -6, 0], spin: -250,
      spear: [-0.24, 0.96, -0.1, 0, 0, 90], gripL: 0.44 }, 'out'],                                  // crouch
    [hop, { hips: [0, 1.04, 0.1], hipsR: [0, -40, 0], spine: [0, -8, 0], chest: [0, -10, 0], head: [0, -6, 0], spin: -320,
      spear: [-0.24, 1.08, -0.26, 0, 2, 90], gripL: 0.5, fL: [0.12, 0.36, 0.9, -20, -300], fR: [-0.04, 0.32, 0.4, 20, -360] }, 'out'],  // hop
    ft(hop - 2, [BUILT.n5.exit[0][0], 0.14, BUILT.n5.exit[0][2] + 0.1, 10, -230], [BUILT.n5.exit[1][0], 0.14, BUILT.n5.exit[1][2] + 0.1, 20, -230]),
    [th, { hips: [0, 0.7, 0.26], hipsR: [6, -70, 0], spine: [6, -8, 0], chest: [2, -6, 0], head: [0, 0, 0], spin: -360,
      spear: [-0.2, 1.12, 0.64, 0, 0, 90], gripL: 0.3, fL: FL, fR: FR }, 'snap'],                   // lands in the lunge thrust
    [s - 4, { hips: [0, 0.76, 0.2], hipsR: [4, -60, 0], spine: [4, -6, 0], chest: [0, -4, 0], head: [0, 0, 0], spin: -366,
      spear: [-0.18, 1.2, 0.56, 8, 14, 90], gripL: 0.3, fL: FL, fR: FR }, 'io'],
    ft(s - 3, [0.12, 0.16, 1.76, -12, -360], null),                                                 // gather: lead foot draws in
    [s - 2, { hips: [0, 0.84, 0.08], hipsR: [0, -30, 0], spine: [-2, 0, 0], chest: [-6, 10, 0], head: [-4, 0, 0], spin: -390,
      spear: spearAbout([0.02, 1.8, 0.2], 60, 20, 0, 0.5), gripL: 0.4 }, 'in'],                    // whip overhead
    spinK(s - 1, -430, 70),
    spinK(s + 1, -560, 66),
    spinK(e + 2, -680, 40),
    // pirouette on the lead foot: it turns with the body, the rear leg swings round in the air and lands wide
    ft(s - 2, [...PV, 0, -380], null),
    rf(s - 2, -390), rf(s - 1, -430), rf(s, -490), rf(s + 1, -560), rf(s + 2, -620),
    ft(e + 2, [...PV, 0, -670], body('n6', e + 2, -680, [-0.3, 0.2, -0.4, -10, -30])),
    ft(e + 3, null, [-0.4, 0.08, 1.02, 0, -770]),
    ft(e + 4, [0.2, 0.16, 1.76, -10, -700], null),
    ft(e + 7, [0.34, 0.08, 1.92, 0, -690], null),                                                   // lead foot steps out wide
    [e + 5, { ...fin, spin: -720 }, 'out'],                                                        // held finish
    [c, { ...fin, hips: [0, 0.72, 0.02], spin: -720 }, 'io'],
    ft(c, [0.34, 0.08, 1.92, 0, -690], [-0.4, 0.08, 1.02, 0, -770]),
    [F, { ...ST, spin: -720 }],
    ft(F, endFeet('n6').fL.map((v, i) => i === 4 ? v - 720 : v), endFeet('n6').fR.map((v, i) => i === 4 ? v - 720 : v)),
  ]);
}

// ---------------------------------------------------------------- charge attacks (benchmark: DW8XL C1–C6)
// One silhouette per tier: C1 coiled poke · C2 rising launcher into a pole-vault over the planted spear · C3 windmill
// twirl while stepping, cocked overhead, ground slam · C4 spear level overhead, 360° sweep (+ a slower second turn), held
// extended · C5 deep low sweep, upswing, spear raised vertical for the ground burst · C6 rising slash, overhead helicopter
// twirl, leap and a plunging stab into the ground.
function c1() {
  const [s, e] = hit('c1'), F = MOVES.c1.frames, c = MOVES.c1.cancel;
  const coil = { hips: [0, 0.72, -0.14], hipsR: [8, -80, 0], spine: [4, -6, 0], chest: [0, -6, 0], head: [2, 4, 0] };
  const ext = { hips: [0, 0.7, 0.34], hipsR: [2, -80, 0], spine: [8, -4, 0], chest: [4, -2, 0], head: [0, 0, 0] };
  const FL = [0.26, 0.08, 1.36, 0, 10], FR = [-0.28, 0.08, 0.35, 0, -80];
  return clipF('c1', [
    [0, { ...ST }],
    ft(3, [0.24, 0.16, 0.42, -10, 12], null),
    ft(6, [0.28, 0.08, 0.52, 0, 10], [-0.25, 0.14, -0.38, 10, -60]),
    ft(9, null, [-0.28, 0.08, -0.5, 0, -80]),
    [s - 6, { ...coil, spear: [-0.34, 0.98, -0.62, 2, 6, 90], gripL: 0.62 }, 'out'],             // drawn back low
    [s - 3, { ...coil, hips: [0, 0.7, -0.18], hipsR: [12, -82, 0], spear: [-0.34, 0.96, -0.72, 2, 8, 90], gripL: 0.66 }, 'io'],       // coiled (glow)
    ft(s - 3, [0.28, 0.08, 0.52, 0, 10], [-0.28, 0.08, -0.5, 0, -80]),
    [s - 1, { ...coil, hips: [0, 0.72, 0.06], hipsR: [8, -82, 0], spine: [6, -6, 0], spear: [-0.26, 1.0, -0.5, 2, 6, 90], gripL: 0.6,
      fL: [0.27, 0.2, 0.96, -16, 10], fR: [-0.28, 0.14, -0.4, 24, -80] }, 'in'],                 // drive: bound off the rear foot
    [s + 1, { ...ext, spear: [-0.2, 1.12, 0.74, 2, 2, 90], gripL: 0.22, fL: FL, fR: [-0.28, 0.2, -0.06, -10, -80] }, 'snap'],   // poke
    [e, { ...ext, hipsR: [-2, -78, 0], chest: [-4, -2, 0], spear: [-0.2, 1.2, 0.72, 2, 16, 90], gripL: 0.22, fR: FR }, 'out'],   // flick up (launch)
    [c - 4, { ...ext, hips: [0, 0.74, 0.3], hipsR: [0, -76, 0], chest: [-2, -2, 0], spear: [-0.2, 1.18, 0.68, 2, 12, 90], gripL: 0.24 }, 'io'],   // held
    ft(c, FL, FR),
    [F, { ...ST }],
  ]);
}
function c2() {
  const [s, e] = hit('c2'), F = MOVES.c2.frames, c = MOVES.c2.cancel, L = MOVES.c2.landFrame;
  const v = (hy, hz, g, extra) => ({ spear: [-0.04, 0.84, 0.62, 0, 90, 0], gripR: g, gripL: g - 0.22, ...extra });   // planted pole, butt on the ground
  const [L0, R0] = BUILT.n1.exit, FL = [0.24, 0.08, 1.1, 0, 20], FR = [-0.24, 0.08, 0.52, 0, -50];
  const land = { hips: [0, 0.7, 0.24], hipsR: [16, -20, 0], spine: [8, -6, 0], chest: [6, -8, 0], head: [4, -6, 0],
    spear: [-0.22, 1.4, 0.36, -70, -2, 0], gripL: -0.46 };
  return clipF('c2', [
    [0, { ...ST }],
    ft(3, [L0[0], 0.1, L0[2], 18, 20], null),
    ft(6, [0.24, 0.24, 0.84, -16, 20], null),
    ft(7, null, [R0[0], 0.1, R0[2], 18, -40]),
    ft(9, FL, null),
    ft(11, null, [-0.22, 0.24, 0.14, -10, -50]),
    [s - 6, { hips: [0, 0.74, 0], hipsR: [10, -40, 0], spine: [8, -10, 0], chest: [8, -10, 0], head: [6, -6, 0],
      spear: [-0.26, 0.9, 0.2, -10, -32, 0], gripL: 0.44 }, 'out'],                                   // low, tip on the ground
    [s - 1, { hips: [0, 0.72, 0.02], hipsR: [12, -44, 0], spine: [8, -12, 0], chest: [8, -12, 0], head: [6, -8, 0],
      spear: [-0.28, 0.88, 0.16, -14, -36, 0], gripL: 0.46, fR: FR }, 'io'],
    [s + 2, { hips: [0, 0.92, 0.3], hipsR: [-4, -16, 0], spine: [-4, -4, 0], chest: [-6, -4, 0], head: [-8, 0, 0],
      spear: [-0.16, 1.2, 0.42, -6, 36, 90], gripL: 0.4, fL: FL, fR: [FR[0], 0.1, FR[2], 20, -40] }, 'lin'],   // rising slash
    [e, { hips: [0, 1.02, 0.34], hipsR: [-10, -10, 0], spine: [-8, 0, 0], chest: [-10, 0, 0], head: [-16, 0, 0],
      spear: [-0.12, 1.5, 0.36, -4, 86, 90], gripL: 0.36, fL: [0.2, 0.2, 1.4, -20, 15], fR: [-0.2, 0.3, 0.9, 20, -30] }, 'out'],      // launcher top
    [e + 4, { hips: [0, 1.5, 0.3], hipsR: [-6, 0, 0], spine: [-4, 0, 0], chest: [-6, 0, 0], head: [-10, 0, 0],
      ...v(0, 0, 1.2), fL: [0.14, 0.9, 1.7, -30, 10], fR: [-0.14, 0.8, 1.4, -20, -10] }, 'out'],                                   // plant, climb
    [e + 9, { hips: [0.04, 2.3, 0.44], hipsR: [30, 0, 0], spine: [10, 0, 0], chest: [6, 0, 0], head: [10, 0, 0],
      ...v(0, 0, 1.52), fL: [0.14, 2.0, 1.6, -40, 10], fR: [-0.14, 1.9, 1.75, -40, -10] }, 'out'],                                 // vault apex, tucked
    [L - 2, { hips: [0, 1.3, 0.36], hipsR: [20, 0, 0], spine: [8, 0, 0], chest: [4, 0, 0], head: [4, 0, 0],
      spear: [-0.22, 2.0, 0.4, -80, 4, 0], gripL: -0.46, fL: [0.22, 0.36, 2.5, -10, 20], fR: [-0.22, 0.3, 1.9, 10, -40] }, 'in'],  // drop, spear across overhead
    [L, { ...land, hips: [0, 0.66, 0.24], fL: [0.26, 0.08, 2.56, 0, 25], fR: [-0.26, 0.08, 1.96, 0, -50] }, 'out'],             // land
    [c, { ...land }, 'io'],
    [F, { ...ST }],
  ]);
}
function c3() {
  const [s1, e1] = hit('c3', 0), [s2, e2] = hit('c3', 1), F = MOVES.c3.frames, c = MOVES.c3.cancel;
  const wheel = (f, a) => [f, { hips: [0, 0.84, 0.08], hipsR: [8, -26, 0], spine: [4, -6, 0], chest: [2, -8, 0], head: [2, 4, 0],
    spear: spearAbout([-0.46, 1.42, 0.26], -4, a, 90, 0.64), gripR: 0.64, gripL: 0.64, lfree: 1, armL: [-30, 0, 40, 30] }, 'lin'];
  const [L0, R0] = BUILT.n2.exit;
  // walk into the crowd while the spear wheels at the right side: four steps, one foot at a time
  const steps = [['R', 12, 16, -0.22, 0.46, -30], ['L', 17, 21, 0.2, 0.94, 15], ['R', 22, 26, -0.22, 0.84, -30], ['L', 27, 31, 0.2, 1.32, 15]];
  const fk = stepKeys(steps, { L: [L0[0], L0[2]], R: [R0[0], R0[2]] }, 0.22, -14);
  const keys = [[0, { ...ST }],
    [s1 - 4, { hips: [0, 0.84, 0.04], hipsR: [6, -26, 0], spine: [4, -6, 0], chest: [2, -8, 0], head: [2, 4, 0],
      spear: spearAbout([-0.46, 1.42, 0.26], -4, 110, 90, 0.64), gripR: 0.64, gripL: 0.64, lfree: 0.6, armL: [-30, 0, 40, 30] }, 'out'], ...fk];
  const n = 8, span = e1 - 1 - s1 + 2;
  for (let i = 0; i <= n; i++) keys.push(wheel(s1 - 2 + Math.round(i * span / n), 110 - i * 150));   // tip goes down in front
  keys.push([s2 - 6, { hips: [0, 0.9, 0.04], hipsR: [-4, -16, 0], spine: [-4, -2, 0], chest: [-6, 0, 0], head: [-4, 0, 0],
    spear: spearAbout([-0.3, 1.66, 0.1], -4, 110 - 1200 - 60, 90, 0.32), gripR: 0.32, gripL: 0.6, lfree: 0.3, armL: [-30, 0, 40, 30] }, 'lin']);   // roll on over the shoulder
  keys.push(
    [s2 - 3, { hips: [0, 0.96, 0.02], hipsR: [-10, -10, 0], spine: [-8, 0, 0], chest: [-12, 4, 0], head: [-6, 0, 0],
      spear: [-0.1, 1.9, 0.0, -4, 160 - 1440, 90], gripL: 0.42, fL: [0.2, 0.08, 1.32, 0, 15] }, 'out'],   // cocked overhead
    [s2 - 1.5, { hips: [0, 0.98, 0.0], hipsR: [-12, -8, 0], spine: [-8, 0, 0], chest: [-14, 6, 0], head: [-8, 0, 0],
      spear: [-0.1, 1.94, -0.04, -4, 168 - 1440, 90], gripL: 0.42, fL: [0.2, 0.2, 1.6, -20, 15] }, 'io'],   // lead knee up
    [s2 + 1, { hips: [0, 0.8, 0.12], hipsR: [10, -14, 0], spine: [6, 0, 0], chest: [6, 0, 0], head: [4, 0, 0],
      spear: [-0.26, 1.5, 0.3, -4, 60 - 1440, 90], gripL: 0.46, fL: [0.22, 0.08, 2.56, 0, 15] }, 'in'],   // bounding lunge lands
    ft(s2 - 2, null, [-0.22, 0.1, 0.84, 20, -40]),
    ft(s2, null, [-0.24, 0.26, 1.3, -10, -50]),
    ft(s2 + 2, null, [-0.25, 0.14, 1.72, 0, -55]),
    [e2, { hips: [0, 0.64, 0.16], hipsR: [26, -18, 0], spine: [16, 0, 0], chest: [14, 0, 0], head: [8, 0, 0],
      spear: [-0.3, 1.0, 0.6, -4, -34 - 1440, 90], gripL: 0.5, fL: [0.26, 0.08, 2.6, 0, 15], fR: [-0.26, 0.08, 1.8, 0, -60] }, 'out'],   // slam into the ground
    [c, { hips: [0, 0.66, 0.14], hipsR: [24, -18, 0], spine: [14, 0, 0], chest: [12, 0, 0], head: [6, 0, 0],
      spear: [-0.3, 1.0, 0.58, -4, -36 - 1440, 90], gripL: 0.5, fL: [0.26, 0.08, 2.6, 0, 15], fR: [-0.26, 0.08, 1.8, 0, -60] }, 'io'],
    [F, stTurn(0, -4)]);
  return clipF('c3', keys);
}
function c4() {
  // tell: spear level overhead · turn 1 (360° in 8 sf) pivoting on the lead foot while the rear leg swings round in the
  // air · turn 2 (slower) pivoting on that foot as the lead leg swings round · lands wide, spear held extended
  const [s, e] = hit('c4'), F = MOVES.c4.frames, c = MOVES.c4.cancel;
  const up = { hips: [0, 0.86, 0], hipsR: [-4, 0, 0], spine: [-4, 0, 0], chest: [-6, 0, 0], head: [-6, 0, 0],
    spear: [-0.26, 1.86, 0.04, 90, 0, 0], gripL: 0.56 };
  // the spear comes down from overhead to the waist over the first ~100° of the turn (no vertical hook in the trail)
  const drop = (f) => Math.max(0, Math.min(1, (f - s + 1) / 3)), lerp = (u, a0, a1) => a0 + (a1 - a0) * u;
  const out = (f, a) => { const u = drop(f), q = u * (2 - u);
    return [f, { ...SIDE, hips: [0, lerp(q, 0.82, 0.76), 0.04], spin: a, gripL: 0.34,
      spear: [lerp(q, -0.24, 0.02), lerp(q, 1.86, 1.02), lerp(q, 0.06, 0.28), lerp(q, 92, 84), lerp(q, 2, -6), 0] }, 'lin']; };
  const held = { ...SIDE, hips: [0, 0.68, 0.04], spin: 720, spear: [-0.02, 1.04, 0.3, 76, -4, 0], gripL: 0.34 };
  const SP = [[s - 1, 0], [s, 30], [s + 1, 75], [s + 2, 125], [s + 3, 180], [s + 4, 230], [s + 5, 280], [s + 6, 325], [s + 7, 360],
    [s + 8, 400], [s + 9, 445], [s + 10, 490], [s + 11, 535], [s + 12, 575], [s + 13, 615], [s + 14, 650], [s + 15, 680], [s + 16, 702], [s + 17, 716]];
  const spAt = new Map(SP);
  const [L0, R0] = BUILT.n3.exit, PL = [0.06, 0.08, 0.42], PR = [-0.3, 0.08, 0.32], FL = [0.45, 0.08, 1.36, 0, 745];
  const keys = [[0, { ...ST }],
    ft(s - 12, [L0[0], 0.08, L0[2], 0, 15], [R0[0], 0.08, R0[2], 0, -40]),
    [s - 6, up, 'out'],                                                                                    // spear level overhead
    ft(s - 8, [PL[0], 0.08, PL[2], 0, 10], null),                                                          // lead foot onto the pivot
    [s - 1, { ...up, hips: [0, 0.82, 0], spear: [-0.26, 1.9, 0.02, 92, 2, 0] }, 'io']];
  for (const [f, a] of SP.slice(1)) keys.push(out(f, a));                                                  // 360° sweeps at the waist
  keys.push(
    ft(s - 1, [...PL, 0, 10], [R0[0], 0.1, R0[2], 20, -40]),
    ft(s + 7, [...PL, 0, 10 + 360], null),
    ft(s + 7, null, [...PR, 0, 330]),
    ft(s + 16, null, [...PR, 0, 330 + 342]),
    ft(s + 8, [PL[0], 0.12, PL[2], -10, 400]),
    ft(s + 17, FL, null),
    [s + 18, held, 'out'],                                                                                 // held extended
    [c, { ...held, spear: [-0.02, 1.04, 0.3, 72, -4, 0], hips: [0, 0.74, 0.04] }, 'io'],
    ft(c, FL, [...PR, 0, 690]),
    [F, { ...ST, spin: 720 }],
    ft(F, [0.17, 0.08, 0.3 + lungeAt(MOVES.c4, F), 0, 735], [-0.2, 0.08, -0.26 + lungeAt(MOVES.c4, F), 0, 690]));
  for (let f = s; f <= s + 6; f++) keys.push(ft(f, null, body('c4', f, spAt.get(f), [-0.26, f < s + 6 ? 0.26 : 0.16, -0.22, -20, -40])));   // rear leg swings round
  for (let f = s + 9; f <= s + 15; f += 2) keys.push(ft(f, body('c4', f, spAt.get(f), [0.26, 0.24, 0.16, -20, 20]), null));   // lead leg swings round
  return clipF('c4', keys);
}
function c5() {
  const [s, e] = hit('c5', 1), F = MOVES.c5.frames, c = MOVES.c5.cancel;
  const low = (y, extra) => ({ hips: [0, 0.56, 0.06], hipsR: [20, y * 0.5, 0], spine: [10, y * 0.3, 0], chest: [8, y * 0.4, 0], head: [-8, y * 0.3, 0], ...extra });
  const [L0, R0] = BUILT.n4.exit;
  // crouched running steps carry the low sweep 2.2 m into the crowd (lead foot lands ahead of the root every stride)
  const run = [['R', 13, 17, -0.34, 0.86, -60], ['L', 16, 20, 0.36, 1.42, 30], ['R', 20, 24, -0.34, 1.86, -60], ['L', 24, 28, 0.34, 2.3, 30], ['L', 34, 38, 0.3, 2.62, 25]];
  const fk = [ft(6, [0.36, 0.08, L0[2], 0, 30], null), ft(8, null, [-0.36, 0.08, R0[2], 0, -60]),
    ...stepKeys(run, { L: [0.36, L0[2]], R: [-0.36, R0[2]] }, 0.26, -16)];
  return clipF('c5', [
    [0, { ...ST }],
    ...fk,
    [8, low(-50, { spear: [-0.34, 0.74, 0.3, -80, -8, 0], gripL: 0.42 }), 'out'],                         // drop into a deep crouch
    [12, low(-56, { spear: [-0.36, 0.72, 0.36, -96, -8, 0], gripL: 0.42 }), 'io'],
    [17, low(-10, { hips: [0, 0.54, 0.14], spear: [-0.24, 0.74, 0.5, -20, -10, 0], gripL: 0.42 }), 'lin'],   // low sweep, running in
    [22, low(40, { hips: [0, 0.56, 0.12], spear: [0.12, 0.76, 0.42, 80, -8, 0], gripL: 0.42 }), 'out'],
    [s - 6, low(46, { hips: [0, 0.6, 0.1], spear: [0.16, 0.8, 0.4, 96, -18, 0], gripL: 0.42 }), 'io'],
    [s - 3, { hips: [0, 0.76, 0.16], hipsR: [4, 20, 0], spine: [0, 10, 0], chest: [-2, 10, 0], head: [-8, 10, 0],
      spear: [0.04, 1.0, 0.36, 60, 40, 0], gripR: 0.05, gripL: 0.4 }, 'lin'],
    [s, { hips: [0, 0.93, 0.2], hipsR: [-8, 0, 0], spine: [-6, 0, 0], chest: [-10, 0, 0], head: [-14, 0, 0],
      spear: [-0.06, 1.3, 0.42, 30, 88, 0], gripR: 0.1, gripL: 0.36 }, 'out'],                             // upswing: spear vertical
    ft(s - 4, null, [-0.34, 0.08, 1.86, 0, -50]),
    ft(s - 1, null, [-0.32, 0.2, 1.92, -10, -45]),
    ft(s + 1, null, [-0.3, 0.1, 1.98, 20, -40]),
    [e + 3, { hips: [0, 0.9, 0.2], hipsR: [-4, -10, 0], spine: [-4, 0, 0], chest: [-6, -4, 0], head: [-10, 0, 0],
      spear: [-0.1, 1.24, 0.4, 20, 90, 0], gripR: 0.1, gripL: 0.34 }, 'io'],
    ft(e + 3, null, [-0.3, 0.08, 1.98, 0, -40]),
    [c, { hips: [0, 0.88, 0.2], hipsR: [-2, -12, 0], spine: [-2, 0, 0], chest: [-4, -4, 0], head: [-6, 0, 0],
      spear: [-0.1, 1.2, 0.4, 20, 88, 0], gripR: 0.1, gripL: 0.34 }, 'io'],
    ft(c, [0.3, 0.08, 2.62, 0, 25], [-0.3, 0.08, 1.98, 0, -40]),
    [F, { ...ST }],
  ]);
}
function c6() {
  const [s1, e1] = hit('c6', 0), [s2, e2] = hit('c6', 1), F = MOVES.c6.frames, c = MOVES.c6.cancel;
  const heli = (f, a, i) => [f, { hips: [0, 0.86 + (i % 2) * 0.03, 0.04], hipsR: [-4, 0, 0], spine: [-4, 0, 0], chest: [-6, 0, 0], head: [-6, 0, 0],
    spin: -(a - 60) * 360 / 1320, spear: spearAbout([-0.08, 2.02, 0.12], a, 4, 0, 0.62), gripR: 0.62, gripL: 0.62, lfree: 1, armL: [0, 0, 80, 10] }, 'lin'];
  const [L0, R0] = BUILT.n5.exit;
  const keys = [[0, { ...ST }],
    [3, { hips: [0, 0.78, 0.04], hipsR: [10, -40, 0], spine: [6, -10, 0], chest: [6, -14, 0], head: [4, -6, 0],
      spear: [-0.28, 0.9, 0.1, -70, -14, 0], gripL: 0.4 }, 'out'],
    [s1 - 2, { hips: [0, 0.96, 0.12], hipsR: [-8, 20, 0], spine: [-6, 10, 0], chest: [-8, 14, 0], head: [-12, 10, 0],
      spear: [0.02, 1.4, 0.3, 60, 56, 45], gripL: 0.4 }, 'lin'],                                           // rising slash
    ft(2, [L0[0], 0.14, L0[2], 10, -60], null),
    ft(5, [0.2, 0.08, 0.2, 0, 10], [R0[0], 0.08, R0[2], 0, -60]),
    ft(8, null, [-0.2, 0.2, 0.0, -10, -40]),
    ft(10, null, [-0.24, 0.08, -0.14, 0, -30])];
  const n = 12, span = e1 - s1 + 2;
  const hk = [];
  for (let i = 0; i <= n; i++) { const f = s1 - 1 + Math.round(i * span / n), a = 60 + i * 110; hk.push([f, -(a - 60) * 360 / 1320]); keys.push(heli(f, a, i)); }   // overhead helicopter twirl
  // walking turn under the twirl: every other heli key one foot steps to its stance spot in the turning body frame
  const spot = { L: [0.22, 0.08, 0.28, 0, 15], R: [-0.24, 0.08, -0.16, 0, -30] };
  const prevSpot = { L: [0.2, 0.08, 0.2, 0, 10], R: [-0.24, 0.08, -0.14, 0, -30] };
  for (let i = 2; i < hk.length; i += 2) {
    const side = (i / 2) % 2 ? 'L' : 'R', k = side === 'L' ? 'fL' : 'fR', [f, sp] = hk[i], [fm, spm] = hk[i - 1];
    const land = body('c6', f, sp, [spot[side][0], 0.08, spot[side][2] + 0.14, 0, spot[side][4]]);
    const mid = body('c6', fm, spm, [spot[side][0], 0.22, spot[side][2], -14, spot[side][4]]);
    keys.push([f - 6, { feet: 1, [k]: prevSpot[side] }], [f - 3, { feet: 1, [k]: mid }], [f, { feet: 1, [k]: land }]);
    prevSpot[side] = land;
  }
  const Y = 1440;                                                   // spear yaw after the twirl (4 turns): forward again
  const lz = lungeAt(MOVES.c6, s2);
  keys.push(
    ft(59, body('c6', 59, -360, [0.2, 0.2, 0.34, -20, 15]), body('c6', 59, -360, [-0.22, 0.16, -0.16, 20, -30])),
    [s2 - 7, { hips: [0, 1.7, 0.2], hipsR: [-10, 0, 0], spine: [-6, 0, 0], chest: [-8, 0, 0], head: [8, 0, 0], spin: -360,
      spear: [-0.3, 2.2, 0.2, Y, -40, 90], gripL: 0.36, fL: body('c6', s2 - 7, -360, [0.18, 0.9, 0.35, -40, 10]),
      fR: body('c6', s2 - 7, -360, [-0.2, 0.8, 0.1, -30, -20]) }, 'out'],                                 // leap, spear raised to stab
    [s2 - 3, { hips: [0, 1.76, 0.26], hipsR: [-2, 0, 0], spine: [2, 0, 0], chest: [4, 0, 0], head: [14, 0, 0], spin: -360,
      spear: [-0.3, 2.28, 0.26, Y, -64, 90], gripL: 0.34, fL: body('c6', s2 - 3, -360, [0.18, 0.84, 0.45, -40, 10]),
      fR: body('c6', s2 - 3, -360, [-0.2, 0.8, 0.15, -30, -20]) }, 'io'],                                 // hang
    [s2, { hips: [0, 0.6, 0.3], hipsR: [30, -10, 0], spine: [16, 0, 0], chest: [14, 0, 0], head: [16, 0, 0], spin: -360,
      spear: [-0.3, 1.18, 0.56, Y, -58, 90], gripL: 0.3, fL: [0.28, 0.08, lz + 0.36, 0, 20 - 360], fR: [-0.28, 0.08, lz - 0.34, 0, -50 - 360] }, 'in'],   // plunge
    [c, { hips: [0, 0.62, 0.28], hipsR: [28, -12, 0], spine: [14, 0, 0], chest: [12, 0, 0], head: [12, 0, 0], spin: -360,
      spear: [-0.3, 1.16, 0.54, Y, -60, 90], gripL: 0.3, fL: [0.28, 0.08, lz + 0.36, 0, 20 - 360], fR: [-0.28, 0.08, lz - 0.34, 0, -50 - 360] }, 'io'],
    [F, stTurn(4, 0, { spin: -360 })],
    ft(F, [0.17, 0.08, lz + 0.3, 0, 15 - 360], [-0.2, 0.08, lz - 0.26, 0, -30 - 360]));
  return clipF('c6', keys);
}

export const ATTACK_CLIPS = {
  n1: n1(), n2: n2(), n3: n3(), n4: n4(), n5: n5(), n6: n6(),

  c1: c1(), c2: c2(), c3: c3(), c4: c4(), c5: c5(), c6: c6(),

  // Dash attack: running lunge thrust
  dash: clip([
    [0, P({ hips: [0, 0.84, 0.05], hipsR: [16, -40, 0], chest: [10, -10, 0], spear: [-0.3, 1.06, -0.3, 4, 6, 90], gripL: 0.5 })],
    K(0.18, thrust(0.66, { hips: [0, 0.76, 0.3], footL: [0.2, 0.08, 0.78, 0, 10], footR: [-0.26, 0.12, -0.44, 30, -60] }), 'snap'),
    K(0.45, thrust(0.62, { hips: [0, 0.78, 0.28], footL: [0.2, 0.08, 0.72, 0, 10] })),
    END,
  ]),
  // Jump attack: aerial diagonal cut downward
  jatk: clip([
    [0, P({ hips: [0, 0.95, 0], footL: [0.16, 0.36, 0.2, -20, 10], footR: [-0.18, 0.3, -0.12, 20, -20], spear: [-0.2, 1.2, -0.1, 30, 30, 0] })],
    K(0.2, { hips: [0, 0.98, 0], hipsR: [-4, -50, 0], chest: [-6, -20, 0], footL: [0.16, 0.4, 0.2, -20, 10], footR: [-0.18, 0.34, -0.12, 20, -20],
      spear: [-0.3, 1.4, -0.1, -90, 45, 0], gripL: 0.42 }, 'out'),
    K(0.42, { hips: [0, 0.95, 0.06], hipsR: [10, 30, 0], chest: [12, 20, 0], footL: [0.16, 0.34, 0.24, -10, 10], footR: [-0.18, 0.3, -0.14, 20, -20],
      spear: [0.05, 1.0, 0.3, 60, -42, 0], gripL: 0.45 }, 'in'),
    [1, P({ hips: [0, 0.95, 0.04], hipsR: [6, 10, 0], footL: [0.16, 0.34, 0.22, -10, 10], footR: [-0.18, 0.3, -0.14, 20, -20],
      spear: [-0.04, 1.0, 0.24, 40, -30, 0] })],
  ]),
  // Jump charge: hang with the spear raised point-down, dive (moveT holds before landFrame until touchdown), stab the
  // blade into the ground on impact (ground contact keeps the tip on the floor) and hold the crouch.
  jc: (() => {
    const L = MOVES.jc.landFrame, F = MOVES.jc.frames, D = MOVES.jc.plunge[0];
    const hang = { hips: [0, 1.0, 0.04], hipsR: [-10, -10, 0], spine: [-6, 0, 0], chest: [-8, 0, 0], head: [10, 0, 0],
      footL: [0.16, 0.5, 0.14, -30, 10], footR: [-0.18, 0.42, -0.12, 20, -20], spear: [-0.1, 1.78, 0.24, 0, -74, 90], gripL: 0.34 };
    const dive = { ...hang, hips: [0, 0.96, 0.1], hipsR: [16, -10, 0], chest: [10, 0, 0], head: [16, 0, 0],
      footL: [0.16, 0.36, 0.0, -10, 10], footR: [-0.18, 0.4, -0.2, 20, -20], spear: [-0.06, 1.3, 0.42, 0, -78, 90] };
    const stab = { hips: [0, 0.6, 0.18], hipsR: [30, -16, 0], spine: [16, 0, 0], chest: [14, 0, 0], head: [16, 0, 0],
      footL: [0.3, 0.08, 0.5, 0, 25], footR: [-0.3, 0.08, -0.3, 0, -50], spear: [-0.06, 1.2, 0.56, 0, -46, 90], gripL: 0.3 };
    return clip([
      [0, P({ hips: [0, 0.95, 0], footL: [0.16, 0.36, 0.2, -20, 10], footR: [-0.18, 0.3, -0.12, 20, -20], spear: [-0.2, 1.2, -0.1, 30, 30, 0] })],
      [4 / F, P(hang), 'out'],
      [6 / F, P({ ...hang, spear: [-0.1, 1.84, 0.2, 0, -70, 90] }), 'io'],
      // integration r1: hold the raised tell through the sim hang, dive when moves.js plunges
      [(D - 1) / F, P({ ...hang, spear: [-0.1, 1.84, 0.2, 0, -70, 90] })],
      [(D + 2) / F, P(dive), 'in'],
      [(L - 1) / F, P(dive)],
      [L / F, P(stab), 'snap'],
      [(L + 8) / F, P({ ...stab, hips: [0, 0.62, 0.16] }), 'io'],
      [MOVES.jc.cancel / F, P({ ...stab, hips: [0, 0.7, 0.12], hipsR: [20, -16, 0], spear: [-0.1, 1.14, 0.46, 0, -40, 90] }), 'io'],
      END,
    ], false, true);
  })(),
};

/**
 * Feet for moves that borrow other moves' clips (moves.js `anim`), baked for their own root motion; the hero applies them
 * over the sampled pose. Dash: four running steps at run speed under the two N4 sweeps, then a leaping lunge into the
 * thrust (both feet off the ground while the lunge carries the body 2 m), front foot lands first.
 */
export const MOVE_FEET = {
  // integration r2: keyed off moves.js dash lunge (combo-system retimed it to a long run + leaping lunge): a stride every
  // 5 sf landing ~0.3 m ahead of the root through the run segment, push off as the lunge starts, front foot lands first
  dash: (() => {
    const [[, r1], [l0, l1]] = MOVES.dash.lunge, la = (f) => lungeAt(MOVES.dash, f), k = [], end = la(MOVES.dash.frames);
    const at = (j, f, v) => ft(f, j ? null : v, j ? v : null);                      // j: 0 = left foot, 1 = right foot
    const spot = [[0.17, 0.3], [-0.2, -0.26]], X = [0.16, -0.16], Y = [5, -5];
    let f = 3, j = 1;
    for (; f < r1; f += 5, j ^= 1) {
      const z = la(f) + 0.3, p = spot[j];
      k.push(at(j, f - 4.5, [p[0], 0.1, p[1], 20, Y[j]]), at(j, f - 2.5, [X[j], 0.3, (p[1] + z) / 2, -20, Y[j]]), at(j, f, [X[j], 0.08, z, 0, Y[j]]));
      spot[j] = [X[j], z];
    }
    const L = [0.2, 0.08, end + 0.45, 0, 10], R = [-0.24, 0.08, end - 0.45, 0, -60], u = l0 + Math.round((l1 - l0) * 0.3);
    k.push(ft(l0 - 1, [spot[0][0], 0.12, spot[0][1], 20, 5], [spot[1][0], 0.12, spot[1][1], 20, -20]),     // push off: both feet leave
      ft(u, [0.2, 0.4, la(u) + 0.3, -20, 10], [-0.22, 0.3, la(u) - 0.1, -10, -40]),
      ft(l0 + 8, L, null), ft(l0 + 9, null, R), ft(MOVES.dash.cancel, L, R));
    return bakeFeet('dash', k).feet;
  })(),
  // integration r2: combo-system's c5 `anim` map stretches the clip's sweep, so clip time ≠ move time; the feet (keyed to the
  // move's lunge and hit frames) follow move time so they stay planted under the root motion
  c5: ATTACK_CLIPS.c5.feet,
  // jump charge: tucked in the air, stab stance on landing, one step per foot back to stance after the cancel frame
  jc: (() => {
    const L = MOVES.jc.landFrame, D = MOVES.jc.plunge[0], c = MOVES.jc.cancel;
    const SL = [0.3, 0.08, 0.5, 0, 25], SR = [-0.3, 0.08, -0.3, 0, -50];
    return bakeFeet('jc', [ft(1, [0.16, 0.36, 0.2, -20, 10], [-0.18, 0.3, -0.12, 20, -20]), ft(4, [0.16, 0.5, 0.14, -30, 10], [-0.18, 0.42, -0.12, 20, -20]),
      ft(D - 1, [0.16, 0.5, 0.14, -30, 10], [-0.18, 0.42, -0.12, 20, -20]), ft(D + 2, [0.16, 0.36, 0.0, -10, 10], [-0.18, 0.4, -0.2, 20, -20]),
      ft(L - 1, [0.2, 0.2, 0.3, -10, 20], [-0.22, 0.2, -0.24, 10, -40]), ft(L, SL, SR), ft(c, SL, SR)], [[0.16, 0.36, 0.2, -20, 10], [-0.18, 0.3, -0.12, 20, -20]]).feet;
  })(),
};
