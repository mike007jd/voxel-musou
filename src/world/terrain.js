// Ground (paved dirt plane + raised voxel cobbles around the arena) and layered hazy mountains. Render-only.
import * as THREE from 'three';
import { makeRng, hash01 } from '../core/rng.js';
import { hazeColor, SUN_DIR, SUN_AZ } from './sky.js';

// smooth 2D value noise from the stable hash (no RNG state)
function vnoise(x, z, seed) {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash01(xi, zi, seed), b = hash01(xi + 1, zi, seed), c = hash01(xi, zi + 1, seed), d = hash01(xi + 1, zi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const noise2 = (x, z, seed = 1) => vnoise(x, z, seed) * 0.62 + vnoise(x * 2.3 + 7, z * 2.3 + 3, seed + 1) * 0.38;

/** Paving mask 0..1: 1 = paved plaza/road, 0 = packed dirt. */
function paveMask(x, z, gateX) {
  const r = Math.hypot(x, z);
  let m = noise2(x * 0.07, z * 0.07, 5) * 1.3 - 0.62;
  m += 0.8 * (1 - Math.min(1, Math.max(0, (r - 12) / 16)));                // central plaza (dust breaks through), frays out by ~28 m
  if (z > 0) m += 1.2 * Math.max(0, 1 - Math.abs(x - gateX) / 8);          // road to the gate
  const hole = noise2(x * 0.15, z * 0.15, 8);                                // broken patches of bare dust
  m -= Math.max(0, Math.min(1, (hole - 0.5) / 0.14)) * 1.0;
  return Math.max(0, Math.min(1, m));
}

function groundTexture() {
  // 24 m tile of packed dusty earth: blotchy tone, gravel, cracks and a few half-buried flat stones.
  const S = 1024, PX = S / 24;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const r = makeRng(99);
  g.fillStyle = '#927c6c'; g.fillRect(0, 0, S, S);                        // pale dust: bright between the dark cobbles (low chroma: the warm sun and grade add the peach)
  for (let i = 0; i < 160; i++) {                                            // tone blotches (dust / damp)
    const x = r.int(0, S), y = r.int(0, S), rad = r.range(30, 110), light = r.chance(0.55);
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, light ? 'rgba(214,186,160,0.42)' : 'rgba(50,38,36,0.2)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 9000; i++) {                                           // gravel / grain (voxel-sized specks, soft)
    const v = r.range(0.84, 1.14), q = r.int(2, 5);
    g.fillStyle = `rgb(${124 * v | 0},${106 * v | 0},${92 * v | 0})`;
    g.fillRect(r.int(0, S - 1), r.int(0, S - 1), q, q);
  }
  for (let i = 0; i < 220; i++) {                                            // half-buried flat stones with bevels
    const w = r.range(0.3, 0.8) * PX, h = r.range(0.25, 0.6) * PX, x = r.int(0, S), y = r.int(0, S), v = r.range(0.75, 1.1);
    g.fillStyle = `rgb(${94 * v | 0},${84 * v | 0},${80 * v | 0})`; g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(255,236,214,0.22)'; g.fillRect(x, y, w, 2);
    g.fillStyle = 'rgba(25,14,12,0.4)'; g.fillRect(x, y + h - 3, w, 3);
  }
  g.strokeStyle = 'rgba(40,26,22,0.35)'; g.lineWidth = 2;                   // cracks
  for (let i = 0; i < 60; i++) {
    let x = r.int(0, S), y = r.int(0, S);
    g.beginPath(); g.moveTo(x, y);
    let a = r.range(0, 6.28);                                                   // wandering, never closing on itself
    for (let k = 0; k < 6; k++) { a += r.range(-0.7, 0.7); const l = r.range(10, 24); x += Math.cos(a) * l; y += Math.sin(a) * l; g.lineTo(x, y); }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function ground(gateX, scorch) {
  const tex = groundTexture();
  const out = new THREE.Group();
  // inner detailed plane: vertex colours = broad dust patches
  const size = 220, seg = 176;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const dust = noise2(x * 0.045 + 40, z * 0.045, 9);
    let k = 1.04 + (dust - 0.5) * 0.85;                                        // broad dust drifts vs darker trampled earth
    k *= 1 - 0.28 * paveMask(x, z, gateX);                                     // dark joints under the paving; bare-dust breaks stay pale
    for (const [sx, , sz, ss] of scorch) k *= 1 - 0.5 * Math.exp(-((x - sx) ** 2 + (z - sz) ** 2) / (9 * ss * ss));   // scorched earth                        // gaps between raised cobbles read dark
    const edge = Math.min(1, Math.max(0, (Math.hypot(x, z) - 80) / 30));    // fade to the outer plane's tone
    k = k * (1 - edge) + 0.98 * edge;
    col[i * 3] = k * 1.03; col[i * 3 + 1] = k; col[i * 3 + 2] = k * 0.96;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const t1 = tex.clone(); t1.needsUpdate = true; t1.repeat.set(size / 24, size / 24);
  const inner = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: t1, vertexColors: true, roughness: 0.96 }));
  inner.receiveShadow = true;
  out.add(inner);
  const og = new THREE.PlaneGeometry(1800, 1800, 8, 8); og.rotateX(-Math.PI / 2);
  const t2 = tex.clone(); t2.needsUpdate = true; t2.repeat.set(1800 / 24, 1800 / 24);
  const outer = new THREE.Mesh(og, new THREE.MeshStandardMaterial({ map: t2, color: 0xf2e6e0, roughness: 0.97 }));
  outer.position.y = -0.03;
  outer.receiveShadow = true;
  out.add(outer);
  return out;
}

/**
 * Raised voxel cobbles (instanced): irregular 1×1 … 2×2-cell blocks packed on a 0.5 m grid over the plaza and the
 * gate road, fraying into scattered loose stones on the dirt.
 */
function cobbles(gateX) {
  const r = makeRng(11), C = 0.42, N = 224, R = N * C / 2;          // covers the whole arena (±47 m)
  const taken = new Uint8Array(N * N), list = [];
  const DUST = new THREE.Color(0xb8a597);
  const PAL = [0x675650, 0x60504b, 0x6d5b54, 0x5b4b47, 0x6f5d54, 0x64544e];   // dark stone ≈ the concept's #5c433a–#614549 once lit and graded
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    if (taken[j * N + i]) continue;
    const x0 = -R + i * C, z0 = -R + j * C;
    const m = paveMask(x0 + C / 2, z0 + C / 2, gateX);
    if (r.next() > (m - 0.36) * 4.5) {                                         // dirt (narrow frayed edge): occasional loose stone
      if (r.chance(0.012)) list.push([x0 + C / 2, z0 + C / 2, r.range(0.18, 0.38), r.range(0.18, 0.34), r.range(0.04, 0.12), r.range(0, 6.28), 0.85, 0, 0]);
      continue;
    }
    const big = r.chance(0.1);
    let w = big || r.chance(0.14) ? 2 : 1, d = big || r.chance(0.14) ? 2 : 1;
    if (i + w > N || taken[j * N + i + 1]) w = 1;
    if (j + d > N) d = 1;
    for (let dj = 0; dj < d; dj++) for (let di = 0; di < w; di++) taken[(j + dj) * N + i + di] = 1;
    const gap = r.range(0.06, 0.11), loose = m < 0.5 ? 1 : 0, heave = r.chance(0.1) ? 1 : 0;   // heaved stones: raised + tipped, they catch the low sun
    // irregular: each stone shrunk, nudged and turned inside its cells, so the paving reads as hand-laid cobbles, not a tile grid
    list.push([x0 + w * C / 2 + r.range(-0.05, 0.05), z0 + d * C / 2 + r.range(-0.05, 0.05), (w * C - gap) * r.range(0.88, 1), (d * C - gap) * r.range(0.88, 1),
      r.range(0.03, 0.06) + (big && r.chance(0.3) ? 0.05 : 0) + loose * r.range(0, 0.02) + heave * r.range(0.03, 0.08), r.range(-0.2, 0.2) + loose * r.range(-0.3, 0.3), 1,
      heave * r.range(-0.09, 0.09), heave * r.range(-0.09, 0.09)]);
  }
  // 16×16 voxel-grain map on every stone face (chipped, dusty tops) — multiplied by the per-stone colour
  const cv = document.createElement('canvas'); cv.width = cv.height = 16;
  const g = cv.getContext('2d');
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const edge = x === 0 || y === 0 || x === 15 || y === 15, v = (0.86 + hash01(x, y, 3) * 0.18 + (edge ? 0.07 : 0)) * 255;
    g.fillStyle = `rgb(${Math.min(255, v * 1.02) | 0},${Math.min(255, v) | 0},${Math.min(255, v * 0.97) | 0})`; g.fillRect(x, y, 1, 1);
  }
  const grain = new THREE.CanvasTexture(cv);
  grain.magFilter = THREE.NearestFilter; grain.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({ map: grain, roughness: 0.93, flatShading: true });
  // with distance the stones blend toward one dusty tone: chunky cobbles up close, a calm dusty plain behind the fight
  // and flatten/widen into one surface (dark sides and gaps turn into moiré stripes at grazing angles)
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float cobbleD = distance((modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz, cameraPosition);
      float cobbleF = smoothstep(12.0, 34.0, cobbleD);
      transformed.y = mix(transformed.y, 0.5, cobbleF * 0.92);
      transformed.xz *= 1.0 + cobbleF * 0.25;                                   // close the dark gaps far away`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${DUST.r.toFixed(3)}, ${DUST.g.toFixed(3)}, ${DUST.b.toFixed(3)}) * 0.62, smoothstep(12.0, 40.0, length(vViewPosition)) * 0.6);   // → the dirt plane's tone`);
  };
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, list.length);
  mesh.name = 'cobbles';
  const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();
  const pos = new THREE.Vector3(), scl = new THREE.Vector3();
  list.forEach(([x, z, w, d, top, rot, v, tx, tz], i) => {
    const h = top + 0.12;
    q.setFromEuler(e.set(tx, rot, tz));
    mt.compose(pos.set(x, top - h / 2, z), q, scl.set(w, h, d));
    mesh.setMatrixAt(i, mt);
    c.set(PAL[r.int(0, PAL.length - 1)]).multiplyScalar(v * r.range(0.8, 1.1));      // wide per-stone value spread: a cobbled floor, not tiles
    c.lerp(DUST, Math.min(1, Math.max(0, noise2(x * 0.09 + 40, z * 0.09, 9) - 0.3) * 1.7 * r.next()));   // dust-covered stones (patchy)
    if (r.chance(0.07)) c.lerp(DUST, 0.45);                                           // a few sun-bleached stones
    mesh.setColorAt(i, c);
  });
  mesh.receiveShadow = true;
  return mesh;
}

/** Clusters of loose voxel rubble on the field: broken paving, masonry chunks and charred planks, all under 0.4 m. */
function rubble(gateX) {
  const r = makeRng(17), list = [];
  const COLS = [0x7a6a60, 0x6c5d56, 0x857266, 0x5f5049, 0x8c7a6c, 0x3a2a22];
  for (let k = 0; k < 90; k++) {
    const a = r.range(0, Math.PI * 2), d = r.range(7, 50), cx = Math.sin(a) * d, cz = Math.cos(a) * d;
    if (cz > 30 && Math.abs(cx - gateX) < 5) continue;                       // keep the gate road clean
    const n = r.int(3, 10), spread = r.range(0.6, 1.6);
    for (let i = 0; i < n; i++) {
      const sz = r.range(0.1, 0.34) * (i === 0 ? 1.25 : 1), wood = r.chance(0.12);
      const sx = wood ? sz * 3 : sz * r.range(0.8, 1.3), sy = wood ? 0.08 : sz * r.range(0.6, 1), szz = wood ? 0.14 : sz * r.range(0.8, 1.3);
      list.push({ p: [cx + r.range(-spread, spread) * (i ? 1 : 0.2), sy / 2 - 0.01, cz + r.range(-spread, spread) * (i ? 1 : 0.2)], s: [sx, sy, szz],
        r: [r.range(-0.25, 0.25), r.range(0, 3.14), r.range(-0.25, 0.25)], c: wood ? COLS[5] : COLS[r.int(0, 4)], v: r.range(0.85, 1.1) });
    }
  }
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.92, flatShading: true }), list.length);
  mesh.name = 'rubble';
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(), c = new THREE.Color();
  list.forEach((b, i) => {
    mesh.setMatrixAt(i, m.compose(p.set(...b.p), q.setFromEuler(e.set(...b.r)), sc.set(...b.s)));
    mesh.setColorAt(i, c.set(b.c).multiplyScalar(b.v));
  });
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

// periodic 1D value noise around the horizon ring
function ringNoise(n, seed) {
  const r = makeRng(seed), vals = Array.from({ length: n }, () => r.next());
  return (a) => {
    const f = ((a / (Math.PI * 2)) % 1 + 1) % 1 * n, i = Math.floor(f), t = f - i, u = t * t * (3 - 2 * t);
    return vals[i % n] * (1 - u) + vals[(i + 1) % n] * u;
  };
}

/**
 * Three rings of jagged mountains, faceted (flat triangles) with baked light and haze so they need no fog and
 * blend into the sky at their base. Peaks stay low in angle (≈2–7°) so the gameplay camera still sees sky above them.
 * Blue-leaning mauve: the post grade warms them onto the concept's #7e7384–#898197.
 */
function mountains() {
  const layers = [
    { r: 360, lo: 6, hi: 36, col: 0x4f4555, haze: 0.3, seed: 3 },
    { r: 500, lo: 16, hi: 62, col: 0x5b516a, haze: 0.44, seed: 7 },
    { r: 690, lo: 30, hi: 112, col: 0x696383, haze: 0.58, seed: 13 },
  ];
  const pos = [], cols = [];
  const A = 420, L = new THREE.Vector3(SUN_DIR.x, 0.6, SUN_DIR.z).normalize();   // the low sun: north faces backlit
  const tmpC = new THREE.Color(), hz = new THREE.Color(), base = new THREE.Color(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3(), cen = new THREE.Vector3();
  for (const ly of layers) {
    const n1 = ringNoise(11, ly.seed), n2 = ringNoise(29, ly.seed + 1), n3 = ringNoise(83, ly.seed + 2), n4 = ringNoise(190, ly.seed + 3);
    const ridge = (a) => {
      const v = n1(a) * 0.5 + n2(a) * 0.3 + n3(a) * 0.14 + n4(a) * 0.06;
      const da = Math.atan2(Math.sin(a - SUN_AZ), Math.cos(a - SUN_AZ));      // a saddle where the sun sets: the disc stays clear
      return (ly.lo + (ly.hi - ly.lo) * Math.pow(Math.max(0, v - 0.18) / 0.82, 1.7)) * (1 - 0.8 * Math.exp(-((da / 0.2) ** 2)));
    };
    // radial profile rows: [radius offset, height fraction, jitter]
    const rows = [[-70, -0.1, 0], [-34, 0.42, 0.18], [0, 1, 0], [40, 0.66, 0.2], [110, 0.15, 0]];
    const vtx = (ai, ri) => {
      const a = (ai / A) * Math.PI * 2, [dr, fh, jit] = rows[ri];
      const rr = ly.r + dr + (hash01(ai, ri, ly.seed) - 0.5) * 16;
      const hh = ridge(a) * fh + (hash01(ai * 3, ri, ly.seed + 9) - 0.5) * jit * (ly.hi * 0.5);
      return [Math.sin(a) * rr, hh, Math.cos(a) * rr];
    };
    base.set(ly.col);
    for (let ai = 0; ai < A; ai++) for (let ri = 0; ri < rows.length - 1; ri++) {
      const a = vtx(ai, ri), b = vtx(ai + 1, ri), c = vtx(ai + 1, ri + 1), d = vtx(ai, ri + 1);
      for (const tri of [[a, b, c], [a, c, d]]) {
        e1.set(tri[1][0] - tri[0][0], tri[1][1] - tri[0][1], tri[1][2] - tri[0][2]);
        e2.set(tri[2][0] - tri[0][0], tri[2][1] - tri[0][1], tri[2][2] - tri[0][2]);
        n.crossVectors(e2, e1).normalize();
        if (n.y < 0) n.negate();
        cen.set((tri[0][0] + tri[1][0] + tri[2][0]) / 3, (tri[0][1] + tri[1][1] + tri[2][1]) / 3, (tri[0][2] + tri[1][2] + tri[2][2]) / 3);
        const lit = 0.55 + 0.85 * Math.max(0, n.dot(L));
        const hf = Math.max(0, Math.min(1, cen.y / ly.hi));
        tmpC.copy(base).multiplyScalar(lit * (0.9 + hf * 0.25));
        hazeColor(e1.copy(cen).normalize(), hz);
        tmpC.lerp(hz, Math.min(1, ly.haze + (1 - hf) * 0.22));
        for (const v of tri) { pos.push(v[0], v[1], v[2]); cols.push(tmpC.r, tmpC.g, tmpC.b); }
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  geo.computeBoundingSphere();
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
  m.renderOrder = -0.5;
  return m;
}

export function buildTerrain(scene, gateX, fieldFires) {
  const r = makeRng(61), scorch = [...fieldFires];
  for (let i = 0; i < 10; i++) { const a = r.range(0, 6.28), d = r.range(14, 42); scorch.push([Math.sin(a) * d, 0, Math.cos(a) * d, r.range(0.5, 0.9)]); }
  scene.add(ground(gateX, scorch), cobbles(gateX), rubble(gateX), mountains());
}
