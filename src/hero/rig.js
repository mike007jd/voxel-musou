// Hero rig: joint hierarchy + pose format + clip sampler + analytic 2-bone IK.
//
// A pose is a flat Float32Array (POSE_SIZE channels, layout in CH). Everything animates in ROOT space
// (character faces +Z, left = +X, right = -X, up = +Y). Blending = lerp of arrays.
//
// The spear is driven by its own `weapon` joint (child of root, NOT of the hands). Clips key the spear directly
// (position of its origin = nominal rear/right-hand grip, plus yaw/elev/roll) so arcs are authored exactly; both
// hands are then placed on the shaft by 2-bone IK. Hands slide along the shaft when a grip is out of reach, so a
// hand never floats off the spear.
//
// Spear local axes: shaft along +Z (tip at +Z), origin at the rear grip. yaw 0 = forward, +90 = to the hero's left,
// elev + = tip up (elev > 90 tips back over the head), roll spins the blade around the shaft.
import * as THREE from 'three';

export const DIM = {
  thigh: 0.44, shin: 0.44, upper: 0.29, fore: 0.27,
  spine: 0.12, chest: 0.2, neck: 0.24, headUp: 0.04,
  shoulderX: 0.235, shoulderY: 0.2, hipX: 0.11, hipY: -0.05,
};

/** Uniform view scale of the posed hero (≈ 1.85 m). The rig poses and solves IK at scale 1 in pose units; hero.js then
 *  scales the root about the ground point, so feet stay planted and hands stay on the shaft. World-space readers of
 *  pose channels (spearWorld, spearElev) apply it. */
export const HERO_SCALE = 1.08;

export const CH = {
  hips: 0, hipsR: 3, spine: 6, chest: 9, head: 12,
  footL: 15, footR: 20,          // x,y,z (ankle, root space), pitch, yaw
  spear: 25,                      // x,y,z, yaw, elev, roll
  gripR: 31, gripL: 32,           // preferred hand offsets along the shaft (m)
  lfree: 33,                      // 0 = left hand on shaft, 1 = left arm FK (armL)
  armL: 34,                       // left arm FK: shoulder rx, ry, rz, elbow bend
  spin: 38,                       // whole-body visual yaw about the hero position (spin attacks; 360 == 0)
  plant: 39,                      // 0 = feet turn with `spin` (root space) · 1 = feet in the hero-facing frame: a spin turns
                                  // the body over planted feet instead of skating them round (attack clips use 1)
};
export const POSE_SIZE = 40;
const ANGLES = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 18, 19, 23, 24, 28, 29, 30, 34, 35, 36, 37, 38];
const IS_ANGLE = new Uint8Array(POSE_SIZE); for (const i of ANGLES) IS_ANGLE[i] = 1;
const D2R = Math.PI / 180;

// ---------------------------------------------------------------- authoring helpers
// Base stance: DW-style ready stance, left foot forward, spear across the body pointing forward-left.
// head is ROOT-space aim (pitch, yaw, roll): [0,0,0] = looking straight ahead whatever the torso does.
export const STANCE = {
  hips: [0, 0.9, 0], hipsR: [0, -25, 0], spine: [6, 6, 0], chest: [4, 8, 0], head: [2, 6, 0],
  footL: [0.17, 0.08, 0.3, 0, 15], footR: [-0.2, 0.08, -0.26, 0, -30],
  spear: [-0.24, 0.98, 0.0, 30, 30, 0], gripR: 0, gripL: 0.5, lfree: 0, armL: [0, 0, 0, 0], spin: 0, plant: 0,
};

/** Build a pose from a spec (angles in degrees). Missing fields come from `base` (default STANCE). */
export function P(spec = {}, base = STANCE) {
  const s = { ...base, ...spec };
  const o = new Float32Array(POSE_SIZE);
  const put = (at, arr) => { for (let i = 0; i < arr.length; i++) o[at + i] = arr[i]; };
  put(CH.hips, s.hips); put(CH.hipsR, s.hipsR); put(CH.spine, s.spine); put(CH.chest, s.chest); put(CH.head, s.head);
  put(CH.footL, s.footL); put(CH.footR, s.footR); put(CH.spear, s.spear);
  o[CH.gripR] = s.gripR; o[CH.gripL] = s.gripL; o[CH.lfree] = s.lfree; put(CH.armL, s.armL); o[CH.spin] = s.spin;
  o[CH.plant] = s.plant || 0;
  for (const i of ANGLES) o[i] *= D2R;
  return o;
}

/** Spear spec whose shaft passes through `center` (m along shaft from origin = `at`). */
export function spearAbout(center, yaw, elev, roll, at) {
  const y = yaw * D2R, e = elev * D2R;
  const dx = Math.sin(y) * Math.cos(e), dy = Math.sin(e), dz = Math.cos(y) * Math.cos(e);
  return [center[0] - dx * at, center[1] - dy * at, center[2] - dz * at, yaw, elev, roll];
}

const EASE = {
  lin: (u) => u,
  in: (u) => u * u,
  out: (u) => 1 - (1 - u) * (1 - u),
  io: (u) => u * u * (3 - 2 * u),
  snap: (u) => 1 - Math.pow(1 - u, 4),       // very fast strike, long settle
};

/**
 * Clip = { keys: [[t, pose, ease?], ...], loop?: bool }. t is normalised 0..1. `ease` shapes the segment ARRIVING at
 * that key. Channels are Catmull-Rom interpolated (smooth arcs, natural overshoot) on the eased segment parameter.
 * `mono` clips use time-aware monotone cubic tangents instead: arcs still flow through keys that keep going the same
 * way, but a key where a channel reverses or holds is a clean stop (chambers and held poses never drift or overshoot).
 */
export function clip(keys, loop = false, mono = false) { return { keys: keys.map(([t, p, e]) => ({ t, p, e: EASE[e || 'io'] })), loop, mono }; }

/** Monotone (Fritsch–Carlson style) tangent at the middle of three samples, in value per unit time. */
function monoSlope(a, b, c, dt0, dt1) {
  const s0 = dt0 > 0 ? (b - a) / dt0 : 0, s1 = dt1 > 0 ? (c - b) / dt1 : 0;
  if (s0 * s1 <= 0) return 0;
  const m = (s0 + s1) / 2, lim = 3 * Math.min(Math.abs(s0), Math.abs(s1));
  return Math.abs(m) > lim ? Math.sign(m) * lim : m;
}

export function sampleClip(c, t, out) {
  const k = c.keys, n = k.length;
  if (n === 1) { out.set(k[0].p); return out; }
  if (c.loop) t -= Math.floor(t); else t = Math.min(1, Math.max(0, t));
  let i = 0;
  while (i < n - 2 && t >= k[i + 1].t) i++;
  const a = k[i], b = k[i + 1];
  let u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
  u = b.e(Math.min(1, Math.max(0, u)));
  const k0 = k[i - 1] || (c.loop ? k[n - 2] : a), k3 = k[i + 2] || (c.loop ? k[1] : b);
  const p0 = k0.p, p3 = k3.p;
  const p1 = a.p, p2 = b.p, u2 = u * u, u3 = u2 * u;
  const dt0 = a.t - k0.t, dt1 = b.t - a.t, dt2 = k3.t - b.t;
  for (let j = 0; j < POSE_SIZE; j++) {
    let m1, m2;
    if (c.mono) { m1 = monoSlope(p0[j], p1[j], p2[j], dt0, dt1) * dt1; m2 = monoSlope(p1[j], p2[j], p3[j], dt1, dt2) * dt1; }
    else { m1 = (p2[j] - p0[j]) * 0.5; m2 = (p3[j] - p1[j]) * 0.5; }
    out[j] = (2 * u3 - 3 * u2 + 1) * p1[j] + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2[j] + (u3 - u2) * m2;
  }
  if (c.feet) c.feet(t, out);                    // baked foot track (attack clips: planted feet + steps, see attacks.js)
  return out;
}

const wrapA = (a) => a - Math.round(a / (2 * Math.PI)) * 2 * Math.PI;
/** Blend two poses; angle channels take the shortest way round (a spin ending at 360 blends cleanly into 0). */
export function blendPose(a, b, w, out) {
  for (let j = 0; j < POSE_SIZE; j++) {
    const d = b[j] - a[j];
    out[j] = a[j] + (IS_ANGLE[j] ? wrapA(d) : d) * w;
  }
  return out;
}

// ---------------------------------------------------------------- feet in the hero-facing frame
/** Foot `b` (CH.footL / CH.footR) of a pose in the hero-facing frame (ignores `spin`): out = [x, z, yaw]. */
function footHero(p, b, out) {
  const k = p[CH.plant], sp = p[CH.spin], c = Math.cos(sp), s = Math.sin(sp), x = p[b], z = p[b + 2];
  out[0] = x + (1 - k) * (x * c + z * s - x); out[1] = z + (1 - k) * (-x * s + z * c - z);
  out[2] = p[b + 4] + (1 - k) * wrapA(sp);
  return out;
}
const _fa = [0, 0, 0];
/** Re-express a pose after the hero's facing turned by `d` rad (a yaw snap at a move start): the body turns through
 *  `spin` as before, the feet stay where they are on the ground (they step to the new stance in the blend). */
export function turnPose(p, d) {
  const c = Math.cos(d), s = Math.sin(d);
  for (const b of [CH.footL, CH.footR]) {
    footHero(p, b, _fa);
    p[b] = _fa[0] * c + _fa[1] * s; p[b + 2] = -_fa[0] * s + _fa[1] * c; p[b + 4] = _fa[2] + d;
  }
  p[CH.plant] = 1; p[CH.spin] += d;
  return p;
}
/**
 * Transition blend (previous pose → new clip) where the feet STEP: each foot travels in the hero frame on a straight
 * line from where it stood (shifted back by the root's own travel since the transition, dx/dz in the hero frame, so it
 * stays put in the world) and lifts on the way when it has to move more than 4 cm — no gliding between moves.
 */
const _fh = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], FEET = [CH.footL, CH.footR];
export function blendStep(a, b, w, out, dx, dz) {
  for (let i = 0; i < 2; i++) { footHero(a, FEET[i], _fh[i]); footHero(b, FEET[i], _fh[i + 2]); }   // first: b may be `out`
  blendPose(a, b, w, out);
  for (let i = 0; i < 2; i++) {
    const f = FEET[i], A = _fh[i], B = _fh[i + 2], ax = A[0] - dx, az = A[1] - dz, d = Math.hypot(B[0] - ax, B[1] - az);
    out[f] = ax + (B[0] - ax) * w; out[f + 2] = az + (B[1] - az) * w;
    out[f + 4] = A[2] + wrapA(B[2] - A[2]) * w;
    if (d > 0.04) out[f + 1] += Math.sqrt(4 * w * (1 - w)) * Math.min(0.2, 0.45 * d);   // stays up until the foot is nearly there
  }
  out[CH.plant] = 1;
  return out;
}

// ---------------------------------------------------------------- ground contact
const GROUND = 0.03, TIP = 2.0, BUTT = 0.8;            // clearance, blade tip / butt cap distance from the rear grip
/**
 * Spear elevation after ground contact: when the blade tip (or the butt) would go below the ground, the spear pivots
 * about the rear grip until it rests on the ground — slams and plunges strike the floor instead of sinking into it.
 * Pure (pose channels + root height), so the renderer and the VFX trail agree.
 */
function spearElev(pose, rootY) {
  let e = pose[29];
  const y0 = pose[26] + (rootY - GROUND) / HERO_SCALE;           // grip height above the clearance plane, pose units
  for (const [len, sgn] of [[BUTT, -1], [TIP, 1]]) {            // tip last: it wins if both can't be satisfied
    const s = -y0 / len * sgn;                           // tip: sin e >= s · butt: sin e <= -s
    if (sgn > 0 ? Math.sin(e) >= s : Math.sin(e) <= s) continue;
    if (Math.abs(s) >= 1) continue;
    const a = Math.asin(s), d1 = wrapA(a - e), d2 = wrapA(Math.PI - a - e);
    e += Math.abs(d1) < Math.abs(d2) ? d1 : d2;
  }
  return e;
}

// ---------------------------------------------------------------- rig
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _S = new THREE.Vector3(), _T = new THREE.Vector3(), _E = new THREE.Vector3(), _pole = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _O = new THREE.Vector3(), _D = new THREE.Vector3();

/** Orient `bone` so its local -Y points along `dir` (world) and local +Z toward `ref` (world, orthogonalised). */
function aimBone(bone, dir, ref) {
  _y.copy(dir).normalize().negate();
  _z.copy(ref).addScaledVector(_y, -ref.dot(_y));
  if (_z.lengthSq() < 1e-8) _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
  _z.normalize();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  _q.setFromRotationMatrix(_m);
  bone.parent.getWorldQuaternion(_q2);
  bone.quaternion.copy(_q2.invert().multiply(_q));
  bone.updateMatrixWorld(true);
}

/** Analytic 2-bone IK. upper → (lenA) → lower → (lenB) → end. `pole` = world direction the middle joint bends toward. */
function solve2(upper, lower, target, pole, lenA, lenB, ref) {
  upper.getWorldPosition(_S);
  _D.subVectors(target, _S);
  let d = _D.length();
  const maxD = (lenA + lenB) * 0.9995;
  d = Math.min(Math.max(d, Math.abs(lenA - lenB) + 1e-3), maxD);
  _D.normalize();
  const cosA = (lenA * lenA + d * d - lenB * lenB) / (2 * lenA * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  _pole.copy(pole).addScaledVector(_D, -pole.dot(_D));
  if (_pole.lengthSq() < 1e-8) _pole.set(0, -1, 0).addScaledVector(_D, _D.y);
  _pole.normalize();
  _E.copy(_S).addScaledVector(_D, lenA * cosA).addScaledVector(_pole, lenA * sinA);
  _T.copy(_S).addScaledVector(_D, d);
  aimBone(upper, _v4.subVectors(_E, _S), ref || _pole);
  aimBone(lower, _v4.subVectors(_T, _E), ref || _pole);
}

/** Shaft offset s closest to s0 such that |O + D s - S| <= r (hands slide along the shaft instead of floating). */
function reachOnShaft(S, O, D, s0, r) {
  _v.subVectors(O, S);
  const b = _v.dot(D), c = _v.lengthSq() - r * r, disc = b * b - c;
  if (disc < 0) return -b;
  const q = Math.sqrt(disc);
  return Math.min(Math.max(s0, -b - q), -b + q);
}

export function createRig() {
  const j = {};
  const mk = (name, parent, x = 0, y = 0, z = 0) => {
    const o = new THREE.Object3D();
    o.name = name; o.position.set(x, y, z); o.rotation.order = 'YXZ';
    if (parent) parent.add(o);
    j[name] = o;
    return o;
  };
  mk('root', null);
  mk('hips', j.root, 0, 0.9, 0);
  mk('spine', j.hips, 0, 0.06, 0);
  mk('chest', j.spine, 0, DIM.spine + 0.08, 0);
  mk('neck', j.chest, 0, DIM.neck, 0);
  mk('head', j.neck, 0, DIM.headUp, 0);
  for (const [s, sx] of [['R', -1], ['L', 1]]) {
    mk('shoulder' + s, j.chest, sx * DIM.shoulderX, DIM.shoulderY, -0.01);
    mk('upperArm' + s, j['shoulder' + s]);
    mk('foreArm' + s, j['upperArm' + s], 0, -DIM.upper, 0);
    mk('hand' + s, j['foreArm' + s], 0, -DIM.fore, 0);
    mk('thigh' + s, j.hips, sx * DIM.hipX, DIM.hipY, 0);
    mk('shin' + s, j['thigh' + s], 0, -DIM.thigh, 0);
    mk('foot' + s, j['shin' + s], 0, -DIM.shin, 0);
  }
  mk('weapon', j.root);

  const reach = (DIM.upper + DIM.fore) * 0.985;
  const gripW = new THREE.Vector3(), fkHand = new THREE.Vector3(), spearDir = new THREE.Vector3();
  const rootQ = new THREE.Quaternion(), chestQ = new THREE.Quaternion(), spearQ = new THREE.Quaternion();
  const footT = [new THREE.Vector3(), new THREE.Vector3()];

  const rig = {
    joints: j,
    root: j.root,
    /** Pose the rig. pos = world position of the root (ground under the hero), yaw = facing. */
    apply(pose, pos, yaw) {
      const R = j.root;
      R.position.copy(pos); R.rotation.set(0, yaw + pose[38], 0);
      j.hips.position.set(pose[0], pose[1], pose[2]);
      j.hips.rotation.set(pose[3], pose[4], pose[5]);
      j.spine.rotation.set(pose[6], pose[7], pose[8]);
      j.chest.rotation.set(pose[9], pose[10], pose[11]);
      // head aim is root-space: cancel the torso chain's pitch/yaw (approximate; eulers are not additive)
      j.head.rotation.set(pose[12] - pose[3] - pose[6] - pose[9], pose[13] - pose[4] - pose[7] - pose[10], pose[14]);
      j.weapon.position.set(pose[25], pose[26], pose[27]);
      j.weapon.rotation.set(-spearElev(pose, pos.y), pose[28], pose[30]);
      for (const s of ['R', 'L']) {
        j['upperArm' + s].quaternion.identity(); j['foreArm' + s].quaternion.identity();
        j['thigh' + s].quaternion.identity(); j['shin' + s].quaternion.identity();
      }
      R.updateMatrixWorld(true);
      // ankle targets (world). plant > 0: the foot channels are in the hero-facing frame, so undo `spin` for them (the
      // body turns over the planted foot). A planted foot the leg can't reach drops the pelvis (≤ 12 cm) instead of
      // lifting the foot off its spot.
      const k = pose[39], sc = Math.cos(pose[38]), ss = Math.sin(pose[38]);
      let drop = 0;
      for (let i = 0; i < 2; i++) {
        const b = i ? 20 : 15, x = pose[b], z = pose[b + 2], T = footT[i];
        T.set(x + k * (x * sc - z * ss - x), pose[b + 1], z + k * (x * ss + z * sc - z)).applyMatrix4(R.matrixWorld);
        j[i ? 'thighR' : 'thighL'].getWorldPosition(_S);
        const hz = Math.hypot(T.x - _S.x, T.z - _S.z), maxD = (DIM.thigh + DIM.shin) * 0.995, vy = _S.y - T.y;
        if (pose[b + 1] < 0.12 && hz < maxD && vy > 0 && hz * hz + vy * vy > maxD * maxD) drop = Math.max(drop, vy - Math.sqrt(maxD * maxD - hz * hz));
      }
      if (drop > 0) { j.hips.position.y -= Math.min(0.12, drop); j.hips.updateMatrixWorld(true); }
      R.getWorldQuaternion(rootQ);
      j.chest.getWorldQuaternion(chestQ);
      j.weapon.getWorldQuaternion(spearQ);
      j.weapon.getWorldPosition(_O);
      spearDir.set(0, 0, 1).applyQuaternion(spearQ);

      // --- arms: right hand on the shaft; left on the shaft or FK (blended by lfree)
      let gR = 0;             // right hand's actual shaft offset (the left keeps clear of it)
      const lfree = pose[33];
      for (const s of ['R', 'L']) {
        const sx = s === 'R' ? -1 : 1;
        const up = j['upperArm' + s], fo = j['foreArm' + s], ha = j['hand' + s];
        up.getWorldPosition(_S);
        const want = s === 'R' ? pose[31] : pose[32];
        let g = reachOnShaft(_S, _O, spearDir, want, reach);
        if (s === 'R') gR = g;
        else if (Math.abs(g - gR) < 0.12) g = gR + (want >= gR ? 0.12 : -0.12);   // keep the hands apart on the shaft
        gripW.copy(_O).addScaledVector(spearDir, g);
        // elbow pole: out, down and back (chest space)
        _pole.set(sx * 0.7, -0.6, -0.5).applyQuaternion(chestQ);
        if (s === 'L' && lfree > 0.001) {
          _e.set(pose[34], pose[35], pose[36]);
          _q.setFromEuler(_e); _q2.copy(chestQ).multiply(_q);
          fkHand.set(0, -DIM.upper, 0).applyQuaternion(_q2).add(_S);
          _q.setFromAxisAngle(_v2.set(1, 0, 0), -pose[37]); _q2.multiply(_q);
          fkHand.add(_v3.set(0, -DIM.fore, 0).applyQuaternion(_q2));
          gripW.lerp(fkHand, lfree);
          _pole.lerp(_v2.set(sx * 0.5, -0.2, -0.8).applyQuaternion(_q2), lfree);
        }
        solve2(up, fo, gripW, _pole, DIM.upper, DIM.fore, _v3.copy(_pole).negate());
        // hand: fist wraps the shaft (local Z along the spear)
        fo.getWorldQuaternion(_q2);
        _q.copy(spearQ);
        if (s === 'L' && lfree > 0.001) _q.slerp(_q2, lfree);
        ha.quaternion.copy(_q2.invert().multiply(_q));
        ha.updateMatrixWorld(true);
      }

      // --- legs: knees bend toward the foot's facing
      for (const s of ['L', 'R']) {
        const b = s === 'L' ? 15 : 20, sx = s === 'L' ? 1 : -1;
        _T.copy(footT[s === 'L' ? 0 : 1]);
        const fy = pose[b + 4] - k * wrapA(pose[38]);
        _pole.set(Math.sin(fy) + sx * 0.25, 0.05, Math.cos(fy)).applyQuaternion(rootQ);
        solve2(j['thigh' + s], j['shin' + s], _T, _pole, DIM.thigh, DIM.shin, null);
        const f = j['foot' + s];
        _e.set(pose[b + 3], fy, 0); _q.setFromEuler(_e); _q.premultiply(rootQ);
        j['shin' + s].getWorldQuaternion(_q2);
        f.quaternion.copy(_q2.invert().multiply(_q));
        f.updateMatrixWorld(true);
      }
    },
  };
  return rig;
}

/** Spear base/tip in world space for a pose (pure; no rig needed). Used by VFX trails. */
export function spearWorld(pose, pos, yaw, zBase, zTip, outBase, outTip) {
  _e.set(-spearElev(pose, pos.y), pose[28], pose[30]); _q.setFromEuler(_e);
  const cy = Math.cos(yaw + pose[38]), sy = Math.sin(yaw + pose[38]);
  for (const [z, out] of [[zBase, outBase], [zTip, outTip]]) {
    _v.set(0, 0, z).applyQuaternion(_q).add(_v2.set(pose[25], pose[26], pose[27])).multiplyScalar(HERO_SCALE);
    out.set(pos.x + _v.x * cy + _v.z * sy, pos.y + _v.y, pos.z - _v.x * sy + _v.z * cy);
  }
}
