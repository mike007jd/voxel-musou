// Voxel castle: stone curtain wall with bastions, gate + two-tier gatehouse, tall corner tower, wooden watchtowers,
// and a garrison of archers on the wall walk. Static merged geometry except the garrison (instanced, idle sway).
import * as THREE from 'three';
import { boxesGeometry, shade } from '../core/voxel.js';
import { makeRng } from '../core/rng.js';

const lit = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, flatShading: true });
const STONE = 0x9c7c72, MORTAR = 0x2e2220,   // warm brown stone: the backlit face lands on the concept's wall (#5a423c–#654c4a) once shaded
  ROOF = 0x3a383f, ROOF_EDGE = 0x5c5660, LACQUER = 0x7c2b1d, WOOD = 0x4a2f22, DARKWOOD = 0x2e1d15;

/** Stone face of blocks (running bond, per-block tint and depth jitter) over a mortar core. Faces -Z. */
function stoneFace(b, r, x0, x1, y0, y1, zf, holes = () => false) {
  const bh = 0.6;
  for (let y = y0, row = 0; y < y1 - 0.05; y += bh, row++) {
    let x = x0 - (row % 2 ? 0.55 : 0);
    while (x < x1) {
      const w = Math.min(r.range(0.9, 1.6), x1 - x), cx = x + w / 2, cy = y + bh / 2, h = Math.min(bh, y1 - y);
      if (w > 0.2 && !holes(cx, cy)) {
        const v = r.range(0.8, 1.14) * (r.chance(0.06) ? 0.78 : 1) * (1 - 0.12 * Math.max(0, 1 - cy / 3));   // grime at the foot
        b.push({ s: [w - 0.07, h - 0.07, 0.3], p: [cx, cy, zf - 0.12 + r.range(-0.05, 0.05)], c: shade(r.chance(0.25) ? 0x876a68 : r.chance(0.15) ? 0xa3856a : STONE, v), skip: [0, 1, 3, 4] });   // no side faces: sunlit block sides read as rain streaks through the joints
      }
      x += w;
    }
  }
}

/** The same coursing on a face that looks +X (the castle's open flank), running z0 → z1. */
function stoneFaceX(b, r, z0, z1, y0, y1, xf) {
  for (let y = y0, row = 0; y < y1 - 0.05; y += 0.6, row++) {
    for (let z = z0 - (row % 2 ? 0.55 : 0); z < z1;) {
      const w = Math.min(r.range(0.9, 1.6), z1 - z), h = Math.min(0.6, y1 - y);
      if (w > 0.2) b.push({ s: [0.3, h - 0.07, w - 0.07], p: [xf + 0.12 + r.range(-0.05, 0.05), y + 0.3, z + w / 2], c: shade(r.chance(0.25) ? 0x876a68 : STONE, r.range(0.8, 1.14)), skip: [1, 3, 4, 5] });
      z += w;
    }
  }
}

function merlons(b, r, x0, x1, y, z, depth = 0.8) {
  for (let x = x0; x + 1.1 <= x1; x += 2.0) b.push({ s: [1.15, 1.25, depth], p: [x + 0.575, y + 0.62, z], c: shade(STONE, r.range(0.82, 1.08)) });
}

/** Chinese pagoda roof hall; origin at the floor centre, front faces -Z. */
function pagoda(b, x, y, z, w, d, tiers = 2, s = 1) {
  const P = (bx) => { bx.p = [bx.p[0] + x, bx.p[1] + y, bx.p[2] + z]; b.push(bx); };
  let yy = 0, ww = w, dd = d;
  for (let t = 0; t < tiers; t++) {
    const hh = (t === 0 ? 3.4 : 2.6) * s;
    P({ s: [ww * 0.86, 0.3 * s, dd * 0.86], p: [0, yy + 0.15 * s, 0], c: 0x4b3d38 });                     // floor
    P({ s: [ww * 0.78, hh, dd * 0.7], p: [0, yy + hh / 2, 0], c: WOOD });                                  // walls
    const nc = Math.max(3, Math.round(ww / 2.6));
    for (let i = 0; i < nc; i++) {
      const cx = -ww * 0.4 + (i / (nc - 1)) * ww * 0.8;
      P({ s: [0.36 * s, hh, 0.36 * s], p: [cx, yy + hh / 2, -dd * 0.37], c: LACQUER });                    // front columns
      if (i < nc - 1) P({ s: [ww * 0.8 / (nc - 1) - 0.5 * s, hh * 0.42, 0.1], p: [cx + ww * 0.4 / (nc - 1), yy + hh * 0.58, -dd * 0.36], c: 0x241612 }); // lattice
    }
    P({ s: [ww * 0.84, 0.4 * s, 0.3 * s], p: [0, yy + hh - 0.2 * s, -dd * 0.38], c: 0x5a2a1c });          // lintel
    yy += hh;
    // roof: stepped slabs + upturned corners
    const rw = ww * 1.28, rd = dd * 1.3;
    for (let k = 0; k < 4; k++) {
      const f = 1 - k * 0.2;
      P({ s: [rw * f, 0.42 * s, rd * f], p: [0, yy + 0.21 * s + k * 0.4 * s, 0], c: k === 0 ? ROOF_EDGE : shade(ROOF, 1 - k * 0.05) });
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      P({ s: [0.8 * s, 0.4 * s, 0.8 * s], p: [sx * rw * 0.47, yy + 0.5 * s, sz * rd * 0.47], c: ROOF_EDGE });
      P({ s: [0.5 * s, 0.4 * s, 0.5 * s], p: [sx * rw * 0.52, yy + 0.85 * s, sz * rd * 0.52], c: ROOF_EDGE });
    }
    yy += 1.6 * s;
    if (t === tiers - 1) {
      P({ s: [rw * 0.5, 0.5 * s, 0.6 * s], p: [0, yy + 0.1 * s, 0], c: 0x2c2a30 });                        // ridge
      for (const sx of [-1, 1]) P({ s: [0.5 * s, 1.1 * s, 0.5 * s], p: [sx * rw * 0.25, yy + 0.6 * s, 0], c: 0x2c2a30 });
    }
    ww *= 0.72; dd *= 0.72;
  }
}

function watchtower(b, x, z, H, s) {
  const P = (bx) => { bx.p = [bx.p[0] + x, bx.p[1], bx.p[2] + z]; b.push(bx); };
  const k = s / 1.9, D = 5.6 * k, L = 0.7, T = L / 0.42;           // far towers: thick legs/bracing survive the background blur
  for (const sx of [-s, s]) for (const sz of [-s, s]) P({ s: [L, H, L], p: [sx, H / 2, sz], r: [sz * 0.012, 0, -sx * 0.012], c: WOOD });
  for (let y = 1.5; y < H - 1; y += 3.2) {
    for (const sz of [-s, s]) {
      P({ s: [2 * s + 0.4, 0.26 * T, 0.26], p: [0, y, sz], c: DARKWOOD });
      P({ s: [0.2 * T, 4.6 * k, 0.2], p: [0, y + 1.6, sz], r: [0, 0, 0.86], c: DARKWOOD });
      P({ s: [0.2 * T, 4.6 * k, 0.2], p: [0, y + 1.6, sz], r: [0, 0, -0.86], c: DARKWOOD });
    }
    for (const sx of [-s, s]) {
      P({ s: [0.26, 0.26 * T, 2 * s + 0.4], p: [sx, y, 0], c: DARKWOOD });
      P({ s: [0.2 * T, 4.6 * k, 0.2], p: [sx, y + 1.6, 0], r: [0.86, 0, 0], c: DARKWOOD });
    }
  }
  P({ s: [D, 0.4, D], p: [0, H, 0], c: WOOD });
  const e = D / 2 - 0.1;
  for (const [sx, sz, w, d] of [[0, -e, D, 0.2], [0, e, D, 0.2], [-e, 0, 0.2, D], [e, 0, 0.2, D]]) P({ s: [w, 1.3, d], p: [sx, H + 0.85, sz], c: DARKWOOD });
  pagoda(b, x, H + 0.2, z, 5.2 * k, 5.2 * k, 1, 0.7);
}

/** Tiny dark voxel spearman (wall garrison, distant reserve army). Origin at the feet, faces +Z. */
export const figureGeometry = () => boxesGeometry([
  { s: [0.42, 0.55, 0.28], p: [0, 1.15, 0], c: 0x2a2226 }, { s: [0.24, 0.25, 0.24], p: [0, 1.56, 0], c: 0xc79470 },
  { s: [0.3, 0.14, 0.3], p: [0, 1.72, 0], c: 0x1f1b1e }, { s: [0.32, 0.1, 0.3], p: [0, 1.6, 0], c: 0xa82a1c },
  { s: [0.36, 0.9, 0.24], p: [0, 0.45, 0], c: 0x241e22 }, { s: [0.06, 2.6, 0.06], p: [0.3, 1.3, 0.1], c: 0x4a3222 },
  { s: [0.08, 0.26, 0.08], p: [0.3, 2.66, 0.1], c: 0xc3c9d0 },
]);

export function buildCastle(scene, { wallZ, gateX }) {
  const r = makeRng(21);
  const b = [];
  // the curtain wall ends at a corner tower 18 m left of the gate (+X is screen-left in the wall-facing view): beyond
  // it the flank is open, so the gameplay camera (frame top ≈ 5° above level) sees the low sun and the watchtowers
  const H = 10, T = 9, X0 = -170, X1 = gateX + 18, z0 = wallZ;
  const gw = 8, gh = 7.6;
  const inGate = (x, y) => Math.abs(x - gateX) < gw / 2 + 0.2 && y < gh + (Math.abs(x - gateX) < gw / 2 - 1.4 ? 0.9 : 0);
  // core + wall walk + plinth
  b.push({ s: [X1 - X0, H, T], p: [(X0 + X1) / 2, H / 2, z0 + T / 2], c: MORTAR });
  stoneFace(b, r, X0, X1, 0, H, z0, inGate);
  b.push({ s: [X1 - X0, 0.9, 0.5], p: [(X0 + X1) / 2, 0.45, z0 - 0.35], c: shade(STONE, 0.7), skip: [4] });
  merlons(b, r, X0, X1, H, z0 + 0.4);
  b.push({ s: [X1 - X0, 1.0, 0.6], p: [(X0 + X1) / 2, H + 0.5, z0 + T - 0.3], c: shade(STONE, 0.8) });  // rear parapet
  // bastions
  for (const bx of [-114, -84, -54, -34]) {
    const w = 7, dz = 3.2;
    b.push({ s: [w, H + 1, dz + 0.5], p: [bx, (H + 1) / 2, z0 - dz / 2 + 0.25], c: MORTAR });
    stoneFace(b, r, bx - w / 2, bx + w / 2, 0, H + 1, z0 - dz);
    for (const sx of [-1, 1]) for (let y = 0; y < H + 1; y += 0.6) b.push({ s: [0.3, 0.53, dz], p: [bx + sx * (w / 2 + 0.05), y + 0.3, z0 - dz / 2], c: shade(STONE, r.range(0.7, 0.95)) });
    merlons(b, r, bx - w / 2, bx + w / 2, H + 1, z0 - dz + 0.4);
  }
  // gate: dark passage, studded double doors, stepped arch, name plaque
  b.push({ s: [gw, gh + 0.9, 0.1], p: [gateX, (gh + 0.9) / 2, z0 - 0.03], c: 0x120c0a });
  for (const sx of [-1, 1]) {
    const cx = gateX + sx * (gw / 4 + 0.08);
    b.push({ s: [gw / 2 - 0.3, gh - 0.3, 0.2], p: [cx, (gh - 0.3) / 2, z0 - 0.12], c: 0x4b2a1a });
    for (let y = 1.1; y < gh - 0.4; y += 1.55) b.push({ s: [gw / 2 - 0.4, 0.2, 0.1], p: [cx, y, z0 - 0.26], c: 0x2b2522 });
    for (let k = 0; k < 4; k++) b.push({ s: [0.14, gh - 0.5, 0.06], p: [cx - gw / 4 + 0.5 + k * (gw / 2 - 1) / 3, (gh - 0.3) / 2, z0 - 0.23], c: 0x3a2014 });
  }
  for (let i = 0; i < 7; i++) {
    const f = i / 6, yy = gh - 0.2 + Math.sin(f * Math.PI) * 0.9;
    b.push({ s: [1.3, 0.62, 0.45], p: [gateX - gw / 2 + 0.3 + f * (gw - 0.6), yy + 0.3, z0 - 0.2], c: shade(STONE, 0.9) });
  }
  b.push({ s: [3.2, 1.3, 0.3], p: [gateX, gh + 1.7, z0 - 0.3], c: 0x1b1412 }, { s: [2.8, 0.95, 0.35], p: [gateX, gh + 1.7, z0 - 0.33], c: 0x6b4a1c });
  // corner tower at the wall's end (tall, pagoda on top) + stepped end cap
  const cx = X1 + 3, TH = 17;
  b.push({ s: [11, TH, 12], p: [cx, TH / 2, z0 + 4], c: MORTAR });
  stoneFace(b, r, cx - 5.5, cx + 5.5, 0, TH, z0 - 2);
  for (let y = 0; y < TH; y += 0.6) b.push({ s: [0.3, 0.53, 12], p: [cx + 5.6, y + 0.3, z0 + 4], c: shade(STONE, r.range(0.72, 0.98)) });
  merlons(b, r, cx - 5.5, cx + 5.5, TH, z0 - 1.6);
  pagoda(b, cx, TH, z0 + 4, 9, 8, 2, 0.85);
  // flank wall receding from the corner tower (seen when the camera swings toward the open side)
  const FL = 70, fx = cx + 5.5;
  b.push({ s: [T, H, FL], p: [fx - T / 2, H / 2, z0 + 10 + FL / 2], c: MORTAR });
  stoneFaceX(b, r, z0 + 10, z0 + 10 + FL, 0, H, fx);
  for (let z = z0 + 10; z + 1.1 <= z0 + 10 + FL; z += 2.0) b.push({ s: [0.8, 1.25, 1.15], p: [fx - 0.4, H + 0.62, z + 0.575], c: shade(STONE, r.range(0.82, 1.08)) });
  // gatehouse on the wall walk
  b.push({ s: [22, 0.6, 8.4], p: [gateX, H + 0.3, z0 + 4.4], c: 0x5a4a44 });
  pagoda(b, gateX, H + 0.6, z0 + 4.6, 19, 8, 2, 1.05);
  // pagoda pavilions on two bastions
  pagoda(b, -54, H + 1, z0 + 1.2, 6.5, 5, 1, 0.75);
  pagoda(b, -114, H + 1, z0 + 1.2, 6.5, 5, 1, 0.75);
  // wooden watchtowers out on the open flank beside the low sun, short enough that the whole tower sits inside the
  // gameplay frame at 85-100 m: [x, z, leg height, half leg spacing]
  const towers = [[gateX + 45, z0 + 14, 6.5, 1.5], [gateX + 61, z0 + 23, 8, 1.55], [gateX + 68, z0 + 2, 6, 1.45],
    [17, -69, 5.5, 1.45], [-20, -70, 6, 1.5]];                        // + two Wei camp towers behind the south palisade
  for (const [x, z, h, s] of towers) watchtower(b, x, z, h, s);
  // siege works at the wall foot: scaling ladders and a roofed battering ram at the gate
  for (const lx of [-100, -70, -44, -24, 4]) {
    const lean = 0.3, len = H / Math.cos(lean) + 0.6, zc = z0 - 0.3 - Math.sin(lean) * len / 2, yc = Math.cos(lean) * len / 2;
    for (const sx of [-0.45, 0.45]) b.push({ s: [0.14, len, 0.14], p: [lx + sx, yc, zc], r: [-lean, 0, 0], c: 0x4a3222 });
    for (let k = 0.6; k < len - 0.3; k += 0.55) b.push({ s: [0.9, 0.08, 0.08], p: [lx, Math.cos(lean) * k, z0 - 0.3 - Math.sin(lean) * k], c: 0x3a2618 });
  }
  const rz = z0 - 4.2;
  b.push({ s: [3.6, 0.35, 6.4], p: [gateX, 0.9, rz], c: 0x3e2a1c });
  for (const sx of [-1, 1]) for (const sz of [-2.4, 2.4]) b.push({ s: [0.3, 1.4, 1.4], p: [gateX + sx * 1.9, 0.7, rz + sz], c: 0x2a1c14 });
  for (const sx of [-1, 1]) b.push({ s: [0.3, 2.6, 6.2], p: [gateX + sx * 1.6, 2.2, rz], c: shade(WOOD, 0.9) });
  for (let k = 0; k < 4; k++) b.push({ s: [4.4 - k * 1.1, 0.35, 6.8], p: [gateX, 3.5 + k * 0.35, rz], c: shade(0x4e3a2a, 1 - k * 0.08) });
  b.push({ s: [0.7, 0.7, 7.5], p: [gateX, 1.8, rz + 1.2], c: 0x5a3e28 }, { s: [0.9, 0.9, 0.5], p: [gateX, 1.8, rz + 4.9], c: 0x3a3a40 });
  const wall = new THREE.Mesh(boxesGeometry(b), lit());
  wall.castShadow = true; wall.receiveShadow = true;
  scene.add(wall);

  // garrison on the wall walk: simple dark voxel archers/spearmen (instanced), idle sway
  const fig = figureGeometry();
  const spots = [];
  for (let x = X0 + 30; x < X1 - 1; x += r.range(1.6, 4.2)) if (Math.abs(x - gateX) > 11.5 || r.chance(0.3)) spots.push([x, H, z0 + r.range(0.9, 1.6)]);
  for (const bx of [-114, -84, -54, -34]) for (let k = 0; k < 3; k++) spots.push([bx + r.range(-2.8, 2.8), H + 1, z0 - 2.4 + r.range(0, 1)]);
  for (let k = 0; k < 5; k++) spots.push([cx + r.range(-4.5, 4.5), TH, z0 - 0.8 + r.range(0, 1)]);
  const garrison = new THREE.InstancedMesh(fig, lit(), spots.length);
  garrison.userData.spots = spots.map(([x, y, z]) => ({ x, y, z, ph: r.range(0, 6.28), yaw: Math.PI + r.range(-0.4, 0.4) }));   // face the arena (-Z)
  garrison.castShadow = false;
  scene.add(garrison);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const pose = (t) => {
    garrison.userData.spots.forEach((s, i) => {
      q.setFromEuler(e.set(Math.sin(t * 1.3 + s.ph) * 0.05, s.yaw + Math.sin(t * 0.4 + s.ph) * 0.25, 0));
      garrison.setMatrixAt(i, m.compose(p.set(s.x, s.y + Math.max(0, Math.sin(t * 2.1 + s.ph)) * 0.05, s.z), q, one));
    });
    garrison.instanceMatrix.needsUpdate = true;
  };
  pose(0);

  return {
    H, cornerX: cx, towerH: TH, x1: X1, towers,
    // fire/brazier spots: [x, y, z, scale]
    fires: [[gateX - 6.5, 0, z0 - 2.2, 1.5], [gateX + 7, 0, z0 - 1.8, 1.3], [-30, H + 0.2, z0 + 1.8, 1.7], [-72, H + 0.2, z0 + 2, 1.5], [cx - 2, TH + 0.2, z0 + 1, 1.2],
      [-45, 0, z0 - 3.2, 1.3], [-63, 0, z0 - 2.6, 1.5], [-93, 0, z0 - 3, 1.2],         // burning siege debris against the wall foot
      [gateX + 24, 0, z0 - 6, 1.35], [-37, 0, z0 - 5, 1.2], [3, 0, z0 - 8, 1.1], [-124, 0, z0 - 3.5, 1.4]],   // … and wrecks burning in front of it (r3)
    update: pose,
  };
}
