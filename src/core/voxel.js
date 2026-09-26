// Shared voxel geometry builders (vertex-coloured, flat normals). Used by hero, crowd, world, vfx.
import * as THREE from 'three';
import { hash01 } from './rng.js';

const _c = new THREE.Color();
// face: normal, 4 corner offsets (unit cube, CCW seen from outside)
const FACES = [
  { n: [1, 0, 0], v: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { n: [-1, 0, 0], v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 1, 0], v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], v: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

function makeBuilder() {
  const pos = [], nor = [], col = [], idx = [];
  return {
    quad(corners, n, r, g, b) {
      const base = pos.length / 3;
      for (const c of corners) { pos.push(c[0], c[1], c[2]); nor.push(n[0], n[1], n[2]); col.push(r, g, b); }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    },
    build() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeBoundingSphere();
      g.computeBoundingBox();
      return g;
    },
  };
}

/**
 * Merge a list of coloured boxes into one geometry.
 * box = { s:[w,h,d], p:[cx,cy,cz], c:0xRRGGBB, r?:[rx,ry,rz] (euler, rad), skip?:[faceIdx...] }
 */
export function boxesGeometry(boxes) {
  const b = makeBuilder();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const v = new THREE.Vector3(), nm = new THREE.Matrix3(), nv = new THREE.Vector3();
  for (const bx of boxes) {
    const [w, h, d] = bx.s, [cx, cy, cz] = bx.p;
    _c.set(bx.c);
    q.setFromEuler(e.set(...(bx.r || [0, 0, 0])));
    m.compose(v.set(cx, cy, cz), q, new THREE.Vector3(1, 1, 1));
    nm.getNormalMatrix(m);
    FACES.forEach((f, fi) => {
      if (bx.skip && bx.skip.includes(fi)) return;
      const corners = f.v.map((c) => v.set((c[0] - 0.5) * w, (c[1] - 0.5) * h, (c[2] - 0.5) * d).applyMatrix4(m).toArray());
      const n = nv.set(...f.n).applyMatrix3(nm).normalize().toArray();
      b.quad(corners, n, _c.r, _c.g, _c.b);
    });
  }
  return b.build();
}

/**
 * Voxel grid → geometry with only exposed faces.
 * grid[i + nx * (j + ny * k)] = 0xRRGGBB for a filled voxel, < 0 for empty.
 * origin = world position of voxel (0,0,0)'s min corner.
 */
function voxelGeometry(nx, ny, nz, size, grid, origin) {
  const at = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? -1 : grid[i + nx * (j + ny * k)]);
  const b = makeBuilder();
  const [ox, oy, oz] = origin;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = at(i, j, k);
    if (c < 0) continue;
    _c.set(c);
    for (const f of FACES) {
      if (at(i + f.n[0], j + f.n[1], k + f.n[2]) >= 0) continue;
      const corners = f.v.map((cv) => [ox + (i + cv[0]) * size, oy + (j + cv[1]) * size, oz + (k + cv[2]) * size]);
      b.quad(corners, f.n, _c.r, _c.g, _c.b);
    }
  }
  return b.build();
}

/** Merge several geometries built by the helpers above (same attribute set). */
export function mergeVoxel(geos) {
  const out = new THREE.BufferGeometry();
  let n = 0;
  for (const g of geos) n += g.attributes.position.count;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3), I = [];
  let o = 0;
  for (const g of geos) {
    P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); C.set(g.attributes.color.array, o * 3);
    for (const ix of g.index.array) I.push(ix + o);
    o += g.attributes.position.count;
  }
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('color', new THREE.BufferAttribute(C, 3));
  out.setIndex(I);
  out.computeBoundingSphere();
  return out;
}

/** Tint a hex colour by factor f (1 = unchanged) — handy for per-voxel shading jitter. */
export function shade(hex, f) {
  const r = Math.min(255, Math.max(0, ((hex >> 16) & 255) * f));
  const g = Math.min(255, Math.max(0, ((hex >> 8) & 255) * f));
  const b = Math.min(255, Math.max(0, (hex & 255) * f));
  return (r << 16) | (g << 8) | b;
}

/**
 * Rasterise boxes into a voxel grid (aligned to the part's pivot) and build an exposed-faces geometry.
 * box = { a:[x0,y0,z0], b:[x1,y1,z1], c: 0xRRGGBB | -1 (carve) | fn(x,y,z,i,j,k) → colour|null, paint?: bool }
 * Later boxes overwrite earlier ones; `paint` boxes only recolour voxels that already exist.
 */
export function sculpt(boxes, v = 0.034, jitter = 0.09) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) if (!b.paint && b.c !== -1) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], b.a[k]); mx[k] = Math.max(mx[k], b.b[k]); }
  const o = mn.map((m) => Math.floor(m / v + 1e-6) * v);
  const n = mx.map((m, k) => Math.max(1, Math.ceil((m - o[k]) / v - 1e-6)));
  const grid = new Int32Array(n[0] * n[1] * n[2]).fill(-1);
  for (const b of boxes) {
    const i0 = [0, 0, 0], i1 = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      i0[k] = Math.max(0, Math.round((b.a[k] - o[k]) / v));
      i1[k] = Math.min(n[k], Math.max(i0[k] + 1, Math.round((b.b[k] - o[k]) / v)));
    }
    for (let kk = i0[2]; kk < i1[2]; kk++) for (let jj = i0[1]; jj < i1[1]; jj++) for (let ii = i0[0]; ii < i1[0]; ii++) {
      const idx = ii + n[0] * (jj + n[1] * kk);
      if (b.paint && grid[idx] < 0) continue;
      const c = typeof b.c === 'function' ? b.c(o[0] + (ii + 0.5) * v, o[1] + (jj + 0.5) * v, o[2] + (kk + 0.5) * v, ii, jj, kk) : b.c;
      if (c == null) continue;
      grid[idx] = c;
    }
  }
  for (let k = 0, idx = 0; k < n[2]; k++) for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++, idx++) {
    if (grid[idx] >= 0) grid[idx] = shade(grid[idx], 1 - jitter / 2 + hash01(i, j, k) * jitter);
  }
  return voxelGeometry(n[0], n[1], n[2], v, grid, o);
}

