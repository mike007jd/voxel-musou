// Locomotion poses: idle (breathing loop), run (procedural stance/swing cycle, no foot skating, banked lean),
// dodge (procedural dive roll: pose here + whole-body pitch applied to the rig root by applyRoll), jump/air, land, hurt.
import * as THREE from 'three';
import { P, clip, sampleClip, blendPose, spearAbout, CH, POSE_SIZE, HERO_SCALE } from '../rig.js';
import { LOCO, cadence } from '../locomotion.js';
import { MOVES } from '../moves.js';

const D2R = Math.PI / 180, TAU = Math.PI * 2;
const { smoothstep } = THREE.MathUtils;

// Run carry (DW8): upright forward lean; the right hand holds the shaft at the hip, butt end up ahead-left past the
// head, blade trailing low behind-right; left arm free.
const RUN_SPEC = {
  hips: [0, 0.84, 0.03], hipsR: [16, 0, 0], spine: [6, 0, 0], chest: [4, 0, 0], head: [2, 0, 0],
  footL: [0.13, 0.08, 0.2, 0, 5], footR: [-0.13, 0.1, -0.22, 20, -5],
  spear: spearAbout([-0.3, 1.0, 0.05], 222, -22, 0, 0.5), gripR: 0.5, gripL: 0.5, lfree: 1, armL: [10, 0, 14, 85],
};
const RUN_BASE = P(RUN_SPEC);
const AIR_FALL = {
  hips: [0, 0.95, 0], hipsR: [-10, 0, 0], spine: [-6, 0, 0], chest: [-8, 0, 0], head: [16, 0, 0],
  footL: [0.16, 0.36, 0.16, 20, 12], footR: [-0.17, 0.26, -0.12, 30, -15],
  spear: spearAbout([-0.66, 1.36, 0.05], -115, 8, 0, 0), gripR: 0, gripL: 0.3, lfree: 1, armL: [0, 0, 100, 14],
};

export const LOCO_CLIPS = {
  idle: clip([
    [0, P()],
    [0.5, P({ hips: [0, 0.885, 0.005], chest: [6, 8, 0], spine: [7, 6, 0], spear: [-0.24, 0.97, 0.01, 30, 31.5, 0] })],
    [1, P()],
  ], true),
  // dive roll body (upright frame; the roll pitch itself is applied to the rig root, the spear is set in rollPose)
  dodge: clip([
    [0, P({ ...RUN_SPEC, hips: [0, 0.8, 0.08], hipsR: [24, 0, 0], footL: [0.12, 0.08, 0.16, 10, 0], footR: [-0.12, 0.14, -0.3, 40, 0] })],
    [0.1, P({ ...RUN_SPEC, hips: [0, 0.72, 0.12], hipsR: [38, 0, 0], spine: [16, 0, 0], chest: [12, 0, 0], head: [34, 0, 0],
      footL: [0.12, 0.1, 0.02, 45, 0], footR: [-0.12, 0.42, -0.45, 75, 0], armL: [-95, 0, 15, 15] }), 'out'],
    [0.22, P({ ...RUN_SPEC, hips: [0, 0.5, -0.02], hipsR: [62, 0, 0], spine: [32, 0, 0], chest: [28, 0, 0], head: [150, 0, 0],
      footL: [0.14, 0.16, 0.14, 70, 0], footR: [-0.14, 0.2, 0.08, 70, 0], armL: [-55, 0, 10, 115] })],
    [0.44, P({ ...RUN_SPEC, hips: [0, 0.52, -0.02], hipsR: [58, 0, 0], spine: [30, 0, 0], chest: [24, 0, 0], head: [140, 0, 0],
      footL: [0.14, 0.1, 0.14, 40, 0], footR: [-0.15, 0.14, 0.02, 45, 0], armL: [-50, 0, 10, 110] })],
    [0.58, P({ ...RUN_SPEC, hips: [0, 0.56, 0.0], hipsR: [38, 0, 0], spine: [12, 0, 0], chest: [10, 0, 0], head: [14, 0, 0],
      footL: [0.16, 0.08, 0.26, -5, 8], footR: [-0.15, 0.1, -0.2, 40, -8], armL: [-35, 0, 25, 50] }), 'out'],
    [0.76, P({ ...RUN_SPEC, hips: [0, 0.66, 0.04], hipsR: [28, 0, 0], spine: [8, 0, 0], chest: [6, 0, 0], head: [6, 0, 0],
      footL: [0.15, 0.08, 0.24, -5, 6], footR: [-0.14, 0.08, -0.2, 25, -6], armL: [-10, 0, 20, 70] })],
    [1, P(RUN_SPEC)],
  ]),
  // air: t = 0 take-off (vy = +jumpV, stretched), 0.5 apex (tucked), 1 falling (vy = -jumpV, legs reaching down)
  air: clip([
    [0, P({ hips: [0, 0.98, 0], hipsR: [-6, -10, 0], spine: [-4, 0, 0], chest: [-6, 5, 0], head: [-6, 0, 0],
      footL: [0.13, 0.0, 0.02, 55, 10], footR: [-0.14, 0.05, -0.14, 60, -15], spear: [-0.24, 1.12, 0.0, 30, 46, 0] })],
    [0.22, P({ hips: [0, 0.95, 0], hipsR: [8, -15, 0], spine: [8, 0, 0], chest: [4, 5, 0], head: [2, 0, 0],
      footL: [0.15, 0.5, 0.22, 20, 10], footR: [-0.16, 0.36, -0.02, 40, -15], spear: [-0.24, 1.15, -0.02, 30, 38, 0] }), 'out'],
    [0.55, P({ hips: [0, 0.95, 0], hipsR: [6, -18, 0], spine: [6, 0, 0], chest: [4, 5, 0], head: [2, 0, 0],
      footL: [0.15, 0.42, 0.2, 10, 10], footR: [-0.16, 0.3, -0.06, 30, -15], spear: [-0.23, 1.12, -0.01, 30, 32, 0] })],
    [1, P({ hips: [0, 0.95, 0], hipsR: [4, -20, 0], chest: [6, 5, 0], footL: [0.16, 0.12, 0.22, -5, 10], footR: [-0.18, 0.16, -0.2, 15, -20],
      spear: [-0.22, 1.05, 0.0, 30, 22, 0] })],
  ]),
  // descent after an air string (DW8 A→X×n: a ≈0.4 s spread-arm fall): torso back, arms flung wide, spear held out
  // right and trailing back, looking down at the landing; legs gather under the body as the fall speeds up.
  // Same time base as `air` (0.5 = vy 0, 1 = falling at jumpV).
  airFall: clip([
    [0.5, P(AIR_FALL)],
    [1, P({ ...AIR_FALL, hips: [0, 0.97, 0], footL: [0.17, 0.14, 0.16, 5, 12], footR: [-0.18, 0.18, -0.14, 15, -15],
      armL: [0, 0, 110, 8], spear: spearAbout([-0.7, 1.42, 0.02], -112, 16, 0, 0) })],
  ]),
  // landing: deep squash with the spear tip planted ahead, then up into the stance (LOCO.landFrames long)
  land: clip([
    [0, P({ hips: [0, 0.6, 0.06], hipsR: [30, -20, 0], spine: [10, 4, 0], chest: [10, 6, 0], head: [8, 0, 0],
      footL: [0.22, 0.08, 0.3, -5, 15], footR: [-0.22, 0.08, -0.22, 10, -30], spear: [-0.26, 0.78, 0.1, 22, -22, 0], gripL: 0.45 })],
    [0.4, P({ hips: [0, 0.64, 0.05], hipsR: [26, -20, 0], spine: [9, 4, 0], chest: [8, 6, 0], head: [6, 0, 0],
      footL: [0.22, 0.08, 0.3, -5, 15], footR: [-0.22, 0.08, -0.22, 10, -30], spear: [-0.26, 0.8, 0.1, 22, -20, 0], gripL: 0.45 }), 'out'],
    [1, P()],
  ]),
  hurt: clip([
    [0, P()],
    [0.25, P({ hips: [0, 0.86, -0.12], hipsR: [-16, -30, 6], spine: [-12, 0, 0], chest: [-10, 0, 0], head: [-18, 0, 0],
      spear: [-0.22, 1.08, -0.1, 50, 30, 0] }), 'out'],
    [1, P()],
  ]),
};

/**
 * Procedural run cycle. phase in radians (2π = one stride = two steps; left foot plants at 0, right at π),
 * k = speed / LOCO.runSpeed, lean = banked turn lean (rad, + = into a left turn).
 * Planted feet slide back at exactly the ground speed (stance travel = v · stance time), so nothing skates.
 */
export function runPose(phase, k, out, lean = 0) {
  out.set(RUN_BASE);
  const v = k * LOCO.runSpeed, T = 2 / cadence(v);
  const s = 0.5 - 0.2 * k;                      // stance fraction of the cycle per foot (flight phase at speed)
  const Ls = v * s * T, zc = 0.04;
  let zL = 0, zR = 0;
  for (const [b, off, x, side] of [[CH.footL, 0, 0.11, 1], [CH.footR, 0.5, -0.11, -1]]) {
    let p = phase / TAU + off; p -= Math.floor(p);
    let z, y, pitch;
    if (p < s) {                                 // stance: heel strike ahead → toe-off behind
      const u = p / s;
      z = zc + Ls * (0.5 - u); y = 0.08; pitch = -0.15 + 0.75 * u * u;
    } else {                                     // swing: heel kicks up behind, knee drives through, reach
      const u = (p - s) / (1 - s), e = u * u * (3 - 2 * u);
      z = zc + Ls * (e - 0.5) - 0.2 * k * Math.sin(Math.PI * u) * (1 - u);
      y = 0.08 + (0.08 + 0.34 * k) * Math.sin(Math.PI * Math.pow(u, 0.75));
      pitch = 0.9 * (1 - e) - 0.25 * e;
    }
    out[b] = x; out[b + 1] = y; out[b + 2] = z; out[b + 3] = pitch * (0.4 + 0.6 * k); out[b + 4] = side * 5 * D2R;
    if (side > 0) zL = z; else zR = z;
  }
  const q = phase / Math.PI - Math.floor(phase / Math.PI);          // step phase: 0 = a foot plants
  const bob = -Math.cos(TAU * (q - s));                              // low at mid-stance, high in flight
  const al = Math.abs(lean), half = Math.max(0.2, Ls * 0.5);
  // locomotion-dodge r3: the stride has to read from the chase camera behind a cape that hides the legs, so the body
  // shows it: a deeper bounce per step, the pelvis shifting over the stance foot and the shoulders rocking with it
  const sw = Math.cos(phase - Math.PI * s);                          // +1 at left mid-stance, -1 at right mid-stance
  out[CH.hips] = lean * 0.18 + sw * 0.035 * k;
  out[CH.hips + 1] = 0.86 - 0.06 * k + bob * 0.05 * k - al * 0.2;    // snap turns drop into a low bank
  out[CH.hipsR] = (10 + 14 * k + al * 20) * D2R + bob * 0.04 * k;
  const hy = (zR - zL) * 0.3;                                        // hips follow the forward leg...
  out[CH.hipsR + 1] = hy;
  out[CH.hipsR + 2] = -lean - sw * 4 * k * D2R;
  out[CH.spine + 1] = -0.5 * hy; out[CH.chest + 1] = -0.8 * hy;      // ...shoulders counter-rotate
  out[CH.chest] = (4 + 4 * k) * D2R;
  out[CH.chest + 2] = sw * 6 * k * D2R;                              // shoulders rock over the stance leg
  out[CH.head + 2] = lean * 0.5;                                     // keep the eyes nearer level in the bank
  out[CH.armL] = (zL / half) * (30 + 35 * k) * D2R;                  // left arm swings against the left leg
  out[CH.armL + 3] = (80 + 15 * k) * D2R;
  out[CH.spear] += sw * 0.03 * k;
  out[CH.spear + 1] += bob * 0.04 * k;                               // right arm (spear) swings against the right leg
  out[CH.spear + 2] -= (zR / half) * 0.14 * k;
  out[CH.spear + 4] -= bob * 3 * k * D2R;
  return out;
}

// ---------------------------------------------------------------- dive roll
const ROLL_PIVOT = [0, 0.48, 0.1];      // root-space point the body pitches around (centre of the tucked ball)
/** Whole-body forward pitch of the roll (rad, 0 → 2π) at normalised dodge time u; done by frame ROLL_PLANT. */
function rollAngle(u) { return TAU * smoothstep(u, 0.02, 0.54); }

const _S = new Float32Array(POSE_SIZE);
/** Dodge pose at normalised time u. The spear counter-rotates against the root pitch so it stays level, trailing. */
export function rollPose(u, out) {
  sampleClip(LOCO_CLIPS.dodge, u, out);
  const th = rollAngle(u), e = -(th > Math.PI ? th - TAU : th) / D2R;
  const sp = spearAbout([-0.34, ROLL_PIVOT[1], ROLL_PIVOT[2]], 186, e, 0, 0.55);
  _S.set(out);
  for (let i = 0; i < 6; i++) _S[CH.spear + i] = i < 3 ? sp[i] : sp[i] * D2R;
  _S[CH.gripR] = 0;
  blendPose(_S, out, smoothstep(u, 0.5, 0.92), out);
  return out;
}

/**
 * Squash & stretch (render-only, from sim anim state): take-off stretches the body along the jump, a landing or the
 * jump-charge impact squashes it flat and springs back with a small overshoot. Returns the vertical scale (1 = none).
 */
function squash(anim) {
  let s = 0;
  if (anim.id === 'air' && anim.t < 0.22) return 1 + 0.15 * (1 - anim.t / 0.22);          // rise: vy > 0.56 jumpV
  if (anim.id === 'land') s = 0.17 * (1 - anim.t) * (1 - anim.t) - 0.05 * Math.sin(Math.PI * anim.t);
  else if (anim.id === 'jc') {
    const u = (anim.t * MOVES.jc.frames - MOVES.jc.landFrame) / 10;
    if (u >= 0 && u < 1) s = 0.22 * (1 - u) * (1 - u) - 0.05 * Math.sin(Math.PI * u);
  }
  return 1 - s;
}

/** View-side (call right after rig.apply, which must see the root at scale 1): squash & stretch about the feet, and
 *  during a dodge the roll pitch of the posed rig root about ROLL_PIVOT. */
export function applyRoll(rig, anim) {
  const R = rig.root, sy = squash(anim);
  if (sy !== 1) { const sx = 1 / Math.sqrt(sy); R.scale.set(sx * HERO_SCALE, sy * HERO_SCALE, sx * HERO_SCALE); R.updateMatrixWorld(true); }
  const th = anim.id === 'dodge' ? rollAngle(anim.t) : 0;
  if (th <= 0 || th >= TAU) return;
  const yaw = R.rotation.y, py = ROLL_PIVOT[1], pz = ROLL_PIVOT[2];
  const c = Math.cos(th), s = Math.sin(th);
  const oy = (py - (py * c - pz * s)) * HERO_SCALE, oz = (pz - (py * s + pz * c)) * HERO_SCALE;
  R.position.x += Math.sin(yaw) * oz; R.position.y += oy; R.position.z += Math.cos(yaw) * oz;
  R.rotation.x = th;
  R.updateMatrixWorld(true);
}

// ---------------------------------------------------------------- dodge afterimages (render-only)
/**
 * Teal voxel afterimages: for the first frames of the roll the hero gets an additive teal flash (i-frames start), and
 * the roll leaves 3 fading ghosts along its path. Copies share the model's geometry and only draw during a dodge.
 * Trail ghosts get a depth pre-pass so the overlapping voxel boxes blend as ONE translucent layer (otherwise the
 * stacked inner faces add up to an opaque teal body), and fade out when they sit between the camera and the hero
 * (a roll straight away from the chase camera would otherwise be hidden behind its own ghosts). Reads sim state only.
 */
export function createDodgeGhosts(scene, model) {
  const src = Object.values(model.meshes).filter((m) => m && m.isMesh);
  const LIFE = 0.24, N = 4;                                    // group 0 = live i-frame flash, 1..3 = trail
  const pre = new THREE.MeshBasicMaterial({ colorWrite: false, transparent: true });   // depth only
  const groups = [];
  let hx = 0, hz = 0;
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  const clone = (geo, mat, order, g) => {
    const c = new THREE.Mesh(geo, mat);
    c.matrixAutoUpdate = false; c.visible = false; c.frustumCulled = false; c.renderOrder = order;
    if (g) c.onBeforeRender = (r, sc, cam) => {                  // view fade: screen overlap of ghost and hero boxes
      const G = groups[g];
      _a.set(G.x, 0.9, G.z).applyMatrix4(cam.matrixWorldInverse); _b.set(hx, 0.9, hz).applyMatrix4(cam.matrixWorldInverse);
      const za = Math.max(0.5, -_a.z), zb = Math.max(0.5, -_b.z);
      const sep = Math.max(Math.abs(_a.x / za - _b.x / zb) / (0.45 / za + 0.45 / zb), Math.abs(_a.y / za - _b.y / zb) / (0.95 / za + 0.95 / zb));
      G.mat.opacity = G.alpha * Math.min(1, Math.max(0, (sep - 0.6) / 0.4));
    };
    scene.add(c);
    return c;
  };
  for (let g = 0; g < N; g++) {
    const mat = new THREE.MeshBasicMaterial({ color: g ? 0x48d8c8 : 0x6fe8dc, transparent: true, opacity: 0,
      blending: g ? THREE.NormalBlending : THREE.AdditiveBlending, depthWrite: false });
    const meshes = src.map((m) => clone(m.geometry, mat, 3, g));
    if (g) for (const m of src) meshes.push(clone(m.geometry, pre, 2));
    groups.push({ mat, meshes, age: LIFE, peak: 0, alpha: 0, x: 0, z: 0 });
  }
  const snap = (g) => {
    for (let i = 0; i < g.meshes.length; i++) { g.meshes[i].matrix.copy(src[i % src.length].matrixWorld); g.meshes[i].matrixWorldNeedsUpdate = true; }
  };
  const show = (g, on) => { for (const m of g.meshes) m.visible = on; };
  // live glow = the model grown about the body centre (an additive shell that also rims the silhouette)
  const _S = new THREE.Matrix4(), _T = new THREE.Matrix4();
  const shell = (g, k, x, y, z) => {
    _S.makeTranslation(x, y, z).multiply(_T.makeScale(k, k, k)).multiply(_T.makeTranslation(-x, -y, -z));
    for (let i = 0; i < g.meshes.length; i++) { g.meshes[i].matrix.multiplyMatrices(_S, src[i].matrixWorld); g.meshes[i].matrixWorldNeedsUpdate = true; }
  };
  // i-frame / jump-charge rim: the same grown shell drawn back faces only, so it shows just outside the silhouette (and
  // around limbs in front of the body) while the armour itself stays readable — the r2 pop turned the hero into a blob
  const rimMat = new THREE.MeshBasicMaterial({ color: 0xe8fffb, side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false });
  const rim = { mat: rimMat, meshes: src.map((m) => clone(m.geometry, rimMat, 3, 0)) };
  const IF = LOCO.dodgeIFrames[1], JC = MOVES.jc;
  let seq = -1, lastT = 0, next = 1;
  return {
    update(hero, rig, dt) {
      const live = groups[0], dodging = hero.state === 'dodge';
      hx = hero.x; hz = hero.z;
      if (dodging && (hero.dodgeSeq !== seq || hero.stateT < lastT)) { seq = hero.dodgeSeq; lastT = -9; }
      // i-frame read (the benchmark shows none): a white-teal pop on the push-off, then a teal shimmer that holds for
      // exactly the invulnerable window and cuts out when it ends. Jump charge: a pulsing blue aura through the apex
      // hang (DW8 A→Y glows while it hangs), flaring just before the plunge.
      // locomotion-dodge r3: the glow is a bright rim + a light body tint (was a 0.75 additive shell = a white blob)
      let glow = 0, k = 1.06, edge = 0, ke = 1.1;
      if (dodging && hero.stateT < IF) {
        const t = hero.stateT;
        glow = t < 3 ? 0.12 - 0.02 * t : 0.05 + 0.03 * Math.cos(t * Math.PI / 2);
        edge = t < 3 ? 0.9 : 0.5 + 0.2 * Math.cos(t * Math.PI / 2);
        k = 1.05; ke = t < 3 ? 1.09 : 1.07;
        live.mat.color.setHex(t < 3 ? 0xc8fff6 : 0x6fe8dc);
        rimMat.color.setHex(t < 3 ? 0xa8fff0 : 0x52e8d8);
      } else if (hero.move === 'jc' && hero.moveT >= JC.hang[0] - 3 && hero.moveT < JC.plunge[0] + 2) {
        const t = hero.moveT, ramp = hero.vy > 0.5 ? 0.35 : Math.min(1, (t - JC.hang[0] + 3) / 6), flare = t >= JC.plunge[0] - 4 ? 1.6 : 1;
        glow = ramp * flare * (0.12 + 0.05 * Math.sin(t * 0.7));
        edge = Math.min(1, ramp * flare * (0.6 + 0.2 * Math.sin(t * 0.7)));
        k = 1.06; ke = 1.1 + 0.02 * Math.sin(t * 0.7) + (flare > 1 ? 0.03 : 0);
        live.mat.color.setHex(0x5a9cff);
        rimMat.color.setHex(0x78b4ff);
      }
      const spawn = dodging && hero.stateT - lastT >= 4 && hero.stateT <= 9;
      if (glow > 0 || spawn) rig.root.updateMatrixWorld(true);
      if (glow > 0) { shell(live, k, hero.x, hero.y + 0.9, hero.z); live.mat.opacity = glow; }
      if (edge > 0) { shell(rim, ke, hero.x, hero.y + 0.9, hero.z); rimMat.opacity = edge; }
      show(live, glow > 0); show(rim, edge > 0);
      if (spawn) {
        const g = groups[next]; next = next % (N - 1) + 1;
        snap(g); g.age = 0; g.peak = hero.stateT < 2 ? 0.5 : 0.38; g.x = hero.x; g.z = hero.z; lastT = hero.stateT;
      }
      for (let i = 1; i < N; i++) {
        const g = groups[i];
        g.age += dt;
        const u = 1 - g.age / LIFE;
        // a ghost only shows once the hero has moved off it (never tints the hero itself)
        if (u > 0) g.alpha = g.peak * u * Math.min(1, Math.hypot(hero.x - g.x, hero.z - g.z) / 1.2);
        show(g, u > 0);
      }
    },
  };
}
