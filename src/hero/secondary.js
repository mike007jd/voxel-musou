// Secondary motion (render-only): five kinds of verlet spring chains with distinct weight, from light to heavy —
// teal-blue hair ribbons, blue spear tassel strands, the long ponytail, the teal front apron and the white cape — plus
// the pauldrons, which turn halfway with the upper arms. Chains are anchored to rig joints and simulated in world space
// with gravity, gusting wind, drag, a pull toward the rest direction (in the anchor's frame) and sphere colliders on
// the body (head, chest, hips, thighs, knees). Segment meshes are voxel slabs placed in world space every frame.
// Visual state only — never touches the sim.
import * as THREE from 'three';
import { vox, C, HV } from './model.js';
import { hash01 } from '../core/rng.js';

const _a = new THREE.Vector3(), _r = new THREE.Vector3(), _t = new THREE.Vector3(), _q = new THREE.Quaternion();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4();
const _c = new THREE.Vector3(), _d = new THREE.Vector3();
const B = (a, b, c) => ({ a, b, c });

function chain(scene, mat, joint, { anchor, rest, n, len, seg, stiff = 0.12, drag = 0.08, wind = 1, face = [0, 0, -1], hit = [], cone = 100, sway = 0 }) {
  const meshes = [];
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(seg(i, n), mat);
    m.castShadow = true;
    m.matrixAutoUpdate = false;
    scene.add(m);
    meshes.push(m);
  }
  const p = Array.from({ length: n + 1 }, () => new THREE.Vector3());
  const o = Array.from({ length: n + 1 }, () => new THREE.Vector3());
  const anchorV = new THREE.Vector3(...anchor), restV = new THREE.Vector3(...rest).normalize(), faceV = new THREE.Vector3(...face);
  const cosC = Math.cos(cone * Math.PI / 180), sinC = Math.sin(cone * Math.PI / 180);
  let init = false;
  const ph = anchor[0] * 7 + anchor[1] * 3 + n;                   // per-chain gust phase
  return {
    reset() { init = false; },
    /** cols: { name: {c: Vector3, r} } — this chain collides with the ones listed in `hit` (name or [name, extraR]). */
    update(dt, t, cols, back) {
      joint.updateWorldMatrix(true, false);
      joint.getWorldQuaternion(_q);
      _a.copy(anchorV).applyMatrix4(joint.matrixWorld);
      _r.copy(restV).applyQuaternion(_q);
      // the wind also leans the rest direction (stiff chains would otherwise never drift at idle)
      if (sway) {
        const gust = 0.55 + 0.3 * Math.sin(t * 1.7 + ph) + 0.15 * Math.sin(t * 3.7 + ph * 2);
        _r.addScaledVector(back, sway * gust);
        _r.x += sway * 0.5 * Math.sin(t * 1.1 + ph); _r.z += sway * 0.5 * Math.cos(t * 0.8 + ph);
        _r.normalize();
      }
      if (!init || p[0].distanceToSquared(_a) > 4) {
        for (let i = 0; i <= n; i++) { p[i].copy(_a).addScaledVector(_r, len * i); o[i].copy(p[i]); }
        init = true;
      }
      const steps = dt > 0 ? Math.max(1, Math.min(6, Math.round(dt * 120))) : 0;   // dt 0 = paused: no motion
      const h = steps ? dt / steps : 0;
      for (let s = 0; s < steps; s++) {
        // anchor moves along its path within the frame (sub-stepped), so fast swings pull the chain smoothly
        p[0].lerpVectors(o[0], _a, (s + 1) / steps);
        for (let i = 1; i <= n; i++) {
          _t.subVectors(p[i], o[i]).multiplyScalar(1 - drag);
          o[i].copy(p[i]);
          p[i].add(_t);
          p[i].y -= 9.8 * h * h;
          // wind streams behind the hero with slow gusts and a lateral sway
          const g = 0.75 + 0.45 * Math.sin(t * 1.7 + i * 0.6) + 0.25 * Math.sin(t * 4.3 + i * 1.3);
          const w = wind * g * 5 * h * h * i / n;
          p[i].addScaledVector(back, w);
          p[i].x += Math.sin(t * 1.1 + i * 0.4) * w * 0.35;
        }
        for (let it = 0; it < 2; it++) for (let i = 1; i <= n; i++) {
          _t.copy(p[i - 1]).addScaledVector(_r, len);
          p[i].lerp(_t, stiff);
          _t.subVectors(p[i], p[i - 1]).normalize();
          // cone limit around the rest direction: cloth and hair swing wide but never flip over the anchor
          const ct = _t.dot(_r);
          if (ct < cosC) {
            _c.copy(_t).addScaledVector(_r, -ct);
            if (_c.lengthSq() < 1e-8) _c.set(1, 0, 0);
            _t.copy(_r).multiplyScalar(cosC).addScaledVector(_c.normalize(), sinC);
          }
          p[i].copy(p[i - 1]).addScaledVector(_t, len);
          for (const k of hit) {
            const [name, extra] = Array.isArray(k) ? k : [k, 0];
            const cl = cols[name], R = cl.r + extra;
            _c.subVectors(p[i], cl.c);
            const dc = _c.length();
            if (dc < R) p[i].copy(cl.c).addScaledVector(_c, R / (dc || 1e-6));
          }
        }
      }
      o[0].copy(_a);
      // orient segments: local -Y along the chain, local Z toward the joint's face direction
      _z.copy(faceV).applyQuaternion(_q);
      for (let i = 0; i < n; i++) {
        _y.subVectors(p[i], p[i + 1]).normalize();
        _t.copy(_z).addScaledVector(_y, -_z.dot(_y));
        if (_t.lengthSq() < 1e-6) _t.set(1, 0, 0);
        _t.normalize();
        _x.crossVectors(_y, _t);
        _m.makeBasis(_x, _y, _t).setPosition(p[i]);
        meshes[i].matrix.copy(_m);
        meshes[i].matrixWorldNeedsUpdate = true;
      }
    },
  };
}

// ---------------------------------------------------------------- segment voxel slabs (local -Y along the chain)
const EMBLEM = [                     // blue dragon-swirl roundel on the cape
  '..XXX..',
  '.XX..X.',
  'X...X.X',
  'X.XXX.X',
  'X.X...X',
  '.X..XX.',
  '..XXX..',
];

function hairSeg(i, n) {
  const w = Math.max(1, Math.round(4 - (i * 3) / (n - 1)));
  const tip = i === n - 1;
  return vox([B([-w, tip ? -6 : -4, -w], [w, 0, w], (x, y, z) => {
    const edge = x === -w || x === w - 1 || z === -w || z === w - 1;
    if (edge && hash01(x + i * 11, y + 50, z) < 0.3) return null;
    if (tip && y < -3 && hash01(x, z, i) < 0.5 + (-3 - y) * 0.15) return null;
    return (x * 2 + z + 40) % 5 === 0 ? C.hairH : (x + z + 40) % 3 === 0 ? C.hairT : C.hair;
  })], HV, { jitter: 0.06, ao: 0.3 });
}

function ribbonSeg(i, n) {
  const tip = i === n - 1;
  return vox([B([-2, -8, 0], [2, 0, 1], (x, y) => (tip && y <= -7 && (x === -1 || x === 0) ? null : x === -2 ? C.ribbonD : C.ribbon))],
    0.012, { off: [0, 0, -0.5], jitter: 0.03, ao: 0.15 });
}

function capeSeg(i, n) {
  const w = Math.round(6 + (i * 2.5) / (n - 1));                  // half-width in voxels: 0.3 m → 0.42 m wide
  const last = i === n - 1;
  const paint = (x, y) => {
    if (last && y === -7 && hash01(x, i, 3) < 0.45) return null;  // ragged hem
    if (last && (y === -5 || y === -4)) return y === -5 ? C.T : C.Td;
    if (i === 1) {
      const row = EMBLEM[-1 - y], ch = row && row[x + 3];
      if (ch === 'X') return C.emb;
    }
    return x === -w || x === w - 1 ? C.capeD : C.cape;
  };
  // 1-voxel cloth whose side edges curl toward the body (a shallow U, not a flat board), with pleats standing out
  // on the back every 5th column (AO shades the folds)
  const curl = (x) => x === -w || x === w - 1 || (i >= 3 && (x === -w + 1 || x === w - 2));
  return vox([
    B([-w, -7, 0], [w, 0, 1], (x, y) => (curl(x) ? null : paint(x, y))),
    B([-w, -7, -1], [w, 0, 0], (x, y) => (curl(x) ? paint(x, y) : null)),
    B([-w, -7, 1], [w, 0, 2], (x, y) => ((x + 40) % 5 === 0 && !curl(x) && !(i === 1 && Math.abs(x) < 4) ? paint(x, y) : null)),
  ],
    0.025, { off: [0, 0, -0.5], jitter: 0.04, ao: 0.18 });
}

function apronSeg(i, n) {
  const last = i === n - 1;
  return vox([B([-3, -5, 0], [3, 0, 1], (x, y) => (last && y === -5 ? (x % 2 ? null : C.S) : last && y === -4 ? C.Wh : x === -3 || x === 2 ? C.Td : C.T))],
    0.025, { off: [0, 0, -0.5], jitter: 0.05, ao: 0.2 });
}

function tasselSeg(i, n) {
  // silk strands: every (x,z) column is one strand with its own shade; the last segment frays to uneven lengths
  const w = i === 0 ? 3 : 2, last = i === n - 1;
  return vox([B([-w, -7, -w], [w, 0, w], (x, y, z) => {
    const h = hash01(x + 9, z + 9, 7);
    if (last && -y > 3 + h * 5) return null;
    if ((x === -w || x === w - 1) && (z === -w || z === w - 1) && i > 0) return null;
    return last && -y > 3 + h * 3 ? C.blueD : h < 0.3 ? C.blueH : h > 0.8 ? C.blueD : C.blue;
  })], 0.014, { jitter: 0.06, ao: 0.25 });
}

// ---------------------------------------------------------------- assembly
export function createSecondary(scene, rig, mat) {
  const j = rig.joints;
  const chains = [];
  const add = (joint, o) => chains.push(chain(scene, mat, joint, o));
  // heaviest → lightest
  add(j.chest, { anchor: [0, 0.255, -0.16], rest: [0, -1, 0.15], n: 6, len: 0.17, stiff: 0.16, drag: 0.22, wind: 1.1, cone: 80, sway: 0.2,
    seg: capeSeg, hit: ['chest', 'hips', 'thighL', 'thighR', 'kneeL', 'kneeR'] });
  add(j.hips, { anchor: [0, -0.02, 0.19], rest: [0, -1, 0.12], n: 3, len: 0.12, stiff: 0.12, drag: 0.14, wind: 0.4, face: [0, 0, 1], cone: 70, sway: 0.08,
    seg: apronSeg, hit: [['thighL', 0.02], ['thighR', 0.02], ['kneeL', 0.02], ['kneeR', 0.02]] });
  add(j.head, { anchor: [0, 14 * HV, -5 * HV], rest: [0, -0.92, -0.4], n: 8, len: 0.07, stiff: 0.09, drag: 0.13, wind: 1.6, cone: 115, sway: 0.4,
    seg: hairSeg, hit: ['head', ['chest', 0.035], ['hips', 0.03]] });
  for (const sx of [-1, 1]) {
    add(j.head, { anchor: [sx * 2.5 * HV, 10.5 * HV, -6.8 * HV], rest: [sx * 0.35, -0.5, -1], n: 5, len: 0.09, stiff: 0.03, drag: 0.06, wind: 2.4, cone: 105, sway: 0.6,
      seg: ribbonSeg, hit: ['head', ['chest', 0.02]] });
  }
  // blue tassel: three bushy strands hanging from under the dragon collar
  for (let k = 0; k < 5; k++) {
    const a = k * 1.2566, ox = Math.cos(a) * 0.016, oy = Math.sin(a) * 0.016;
    add(j.weapon, { anchor: [ox, oy, 1.43], rest: [ox * 12, oy * 4 - 1, -0.35], n: 3, len: 0.064, stiff: 0.05 + k * 0.004, drag: 0.12, wind: 0.8, cone: 130, sway: 0.15,
      face: [1, 0, 0], seg: tasselSeg });
  }

  const cols = {};
  for (const k of ['head', 'chest', 'hips', 'thighL', 'thighR', 'kneeL', 'kneeR']) cols[k] = { c: new THREE.Vector3(), r: 0 };
  const setCol = (k, joint, x, y, z, r) => { cols[k].c.set(x, y, z).applyMatrix4(joint.matrixWorld); cols[k].r = r; };
  const back = new THREE.Vector3(), _bq = new THREE.Quaternion(), DOWN = new THREE.Vector3(0, -1, 0);
  let t = 0;
  return {
    reset() { for (const c of chains) c.reset(); },
    update(dt) {
      t += dt;
      // pauldrons: swing (no twist) halfway toward the upper arm's direction, in shoulder (= chest) space
      for (const s of ['L', 'R']) {
        _d.set(0, -1, 0).applyQuaternion(j['upperArm' + s].quaternion);
        _q.setFromUnitVectors(DOWN, _d);
        j['pauldron' + s].quaternion.identity().slerp(_q, 0.5);
      }
      j.root.updateMatrixWorld(true);
      setCol('head', j.head, 0, 7 * HV, 0, 7.4 * HV);
      setCol('chest', j.chest, 0, 0.08, 0, 0.19);
      setCol('hips', j.hips, 0, -0.06, 0, 0.155);
      for (const s of ['L', 'R']) {
        setCol('thigh' + s, j['thigh' + s], 0, -0.22, 0, 0.095);
        setCol('knee' + s, j['shin' + s], 0, -0.02, 0, 0.09);
      }
      back.set(0, 0.15, -1).applyQuaternion(j.root.getWorldQuaternion(_bq));
      for (const c of chains) c.update(dt, t, cols, back);
    },
  };
}
