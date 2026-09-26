// Battlefield dressing: 魏/蜀 banners with wind-driven cloth, fires (voxel flames + embers), smoke columns, and the
// Wei camp ring (palisade, tents, barricades). Everything animates as a pure function of render time → capture-
// deterministic; nothing touches sim state.
import * as THREE from 'three';
import { boxesGeometry, shade } from '../core/voxel.js';
import { makeRng } from '../core/rng.js';
import { figureGeometry } from './castle.js';

const WIND = new THREE.Vector3(0.75, 0, 0.55).normalize();   // blows away from the arena toward the castle's end
const lit = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, flatShading: true });
const frac = (x) => x - Math.floor(x);

// ---------------------------------------------------------------- banners
function bannerTexture(ch, { bg, fg, border, w = 128, h = 256, tatter = true, seed = 1 }) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), r = makeRng(seed);
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 260; i++) {                                     // weave / weathering
    g.fillStyle = r.chance(0.5) ? 'rgba(255,225,190,0.06)' : 'rgba(0,0,0,0.09)';
    g.fillRect(r.int(0, w), r.int(0, h), r.int(2, 10), r.int(1, 4));
  }
  if (border) { g.strokeStyle = border; g.lineWidth = w * 0.09; g.strokeRect(w * 0.045, w * 0.045, w * 0.91, h * 0.86); }
  g.fillStyle = fg;
  g.font = `bold ${Math.round(w * 0.66)}px "Xingkai SC","STXingkai","Kaiti SC","STKaiti","KaiTi","Songti SC",serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (ch) g.fillText(ch, w / 2, h * 0.42);   // fill only: a stroke closes 魏's dense counters into a blob at gameplay distance
  const grad = g.createLinearGradient(0, 0, 0, h);                    // soot toward the hem
  grad.addColorStop(0.6, 'rgba(20,8,6,0)'); grad.addColorStop(1, 'rgba(20,8,6,0.45)');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  if (tatter) {
    g.globalCompositeOperation = 'destination-out';
    for (let x = 0; x < w; x += w / 16) g.fillRect(x, h * 0.84 + r.range(0, h * 0.14), w / 16, h);
    for (let i = 0; i < 5; i++) g.fillRect(r.int(0, w), r.int(h * 0.3, h * 0.8), r.int(3, 7), r.int(3, 7));   // holes
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

/**
 * Cloth: plane in local XY, u = 0 at the attached edge (pole) → 1 free edge, v = 0 top → 1 hem.
 * kind 'hang' (T-pole standard: top + pole edge attached), 'flag' (pole edge only, streams in the wind),
 * 'drape' (hung flat on a wall, top edge attached).
 */
function cloth(mat, w, h, kind, ph) {
  const geo = new THREE.PlaneGeometry(w, h, kind === 'drape' ? 12 : 8, kind === 'flag' ? 6 : 14);
  geo.translate(w / 2, -h / 2, 0);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.userData = { base: Float32Array.from(geo.attributes.position.array), w, h, kind, ph };
  return m;
}

function animateCloth(m, t) {
  const { base, w, h, kind, ph } = m.userData, p = m.geometry.attributes.position.array;
  for (let i = 0; i < p.length; i += 3) {
    const bx = base[i], by = base[i + 1], u = Math.max(0, bx / w), v = Math.max(0, -by / h);
    let z = 0, x = bx, y = by;
    if (kind === 'hang') {
      const a = Math.pow(u, 0.85) * (0.35 + 0.65 * v) * w * 0.28;
      z = a * (Math.sin(t * 2.6 - u * 4.2 - v * 2.4 + ph) * 0.72 + Math.sin(t * 4.3 - u * 7.5 + v * 1.3 + ph * 1.7) * 0.28);
      // in-plane gusts: the hem swings sideways (reads at 50 m, where out-of-plane ripple alone looks static)
      const sway = Math.sin(t * 2.1 + ph - v * 1.4) * 0.65 + Math.sin(t * 3.7 + ph * 1.3 - v * 2.6) * 0.35;
      x = bx - Math.abs(z) * 0.25 + sway * v * v * w * 0.42 * (0.3 + 0.7 * u);
      y = by + Math.sin(t * 1.7 + ph + u * 2) * 0.05 * v * h * u;
    } else if (kind === 'flag') {
      const a = u * h * 0.3;
      z = a * (Math.sin(t * 6.5 - u * 7 + ph) * 0.8 + Math.sin(t * 9.1 - u * 11 + ph) * 0.2);
      y = by - u * u * h * 0.15;
    } else {
      // drape on the wall: gusts lift the hem off the stone and swing it sideways
      // (horizontal travelling ripples: their facets catch the light differently every frame)
      z = Math.pow(v, 1.6) * (0.55 + 0.5 * Math.sin(t * 1.1 + ph + u * 1.5)) + Math.sin(t * 2.4 - u * 7 - v * 2 + ph) * (0.08 + 0.32 * v);
      x = bx + v * v * (Math.sin(t * 1.3 + ph - v * 1.4) * 0.8 + Math.sin(t * 2.7 + ph * 2 + u * 2) * 0.25);
    }
    p[i] = x; p[i + 1] = y; p[i + 2] = z;
  }
  m.geometry.attributes.position.needsUpdate = true;
}

// ---------------------------------------------------------------- fire, embers, smoke (instanced, stateless)
/** Smoke puff: camera-facing quad with a 16×16 pixel-art cloud (hard texels, 3 alpha steps, lighter rim where the
 * low sun catches the edge) — reads as soft smoke yet stays in the voxel/pixel style. Instance matrix = position +
 * rotation/scale in the view plane. */
function smokeMaterial() {
  const N = 16, cv = document.createElement('canvas'); cv.width = cv.height = N;
  const g = cv.getContext('2d'), img = g.createImageData(N, N);
  const blobs = [[0.5, 0.56, 0.36], [0.33, 0.44, 0.24], [0.66, 0.4, 0.26], [0.48, 0.3, 0.22]];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x + 0.5) / N, v = (y + 0.5) / N;
    let d = 9;
    for (const [bx, by, br] of blobs) d = Math.min(d, Math.hypot(u - bx, v - by) / br);
    const a = d < 0.7 ? 1 : d < 0.92 ? 0.6 : d < 1.08 ? 0.28 : 0, rim = d > 0.7 ? 1.25 : 1 - 0.18 * (v - 0.3);
    const i = (y * N + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.min(255, 200 * rim); img.data[i + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(cv);
  map.magFilter = THREE.NearestFilter; map.minFilter = THREE.NearestFilter; map.generateMipmaps = false;
  const mat = new THREE.MeshBasicMaterial({ map, transparent: true, opacity: 0.62, depthWrite: false });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `
      vec4 mvPosition = modelViewMatrix * vec4( instanceMatrix[3].xyz, 1.0 );
      mvPosition.xy += mat2( instanceMatrix[0].xy, instanceMatrix[1].xy ) * transformed.xy;
      gl_Position = projectionMatrix * mvPosition;`);
  };
  return mat;
}

function fireSystem(scene, list) {
  const r = makeRng(77);
  const flames = [], embers = [], puffs = [];
  for (const [x, y, z, s, smoke = s >= 1.3] of list) {
    const nf = Math.round(20 * s);
    for (let i = 0; i < nf; i++) flames.push({ x, y, z, s, ph: r.next(), sp: r.range(1.1, 2.0), ox: r.range(-0.7, 0.7), oz: r.range(-0.7, 0.7), h: r.range(1.4, 3.2), sz: r.range(0.32, 0.62), rot: r.range(0, 6.28) });
    for (let i = 0; i < Math.round(10 * s); i++) embers.push({ x, y, z, s, ph: r.next(), sp: r.range(0.18, 0.35), ox: r.range(-0.8, 0.8), oz: r.range(-0.8, 0.8), w: r.range(0, 6.28) });
    if (smoke) for (let i = 0; i < 30; i++) puffs.push({ x, y, z, s, ph: i / 30 + r.range(0, 0.02), sp: r.range(0.075, 0.095), ox: r.range(-0.8, 0.8), oz: r.range(-0.8, 0.8), rot: r.range(0, 6.28), v: r.range(0.8, 1.2) });
  }
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const add = new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
  const fm = new THREE.InstancedMesh(cube, add, flames.length + embers.length);
  fm.frustumCulled = false;
  fm.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array((flames.length + embers.length) * 3), 3);
  const sm = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), smokeMaterial(), puffs.length);
  sm.frustumCulled = false;
  sm.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(puffs.length * 3), 3);
  sm.renderOrder = 1;
  fm.name = 'flames'; sm.name = 'smoke';
  scene.add(fm, sm);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(), c = new THREE.Color();
  const HOT = new THREE.Color(7, 5.2, 2.4), MID = new THREE.Color(5.5, 2.0, 0.45), END = new THREE.Color(1.4, 0.3, 0.08);
  const SMOKE_LO = new THREE.Color(0x3a2c28), SMOKE_HI = new THREE.Color(0x857680), GLOW = new THREE.Color(0.9, 0.35, 0.08);
  return (t) => {
    let i = 0;
    for (const f of flames) {
      const k = frac(t * f.sp + f.ph), s = f.s;
      p.set(f.x + f.ox * s * (1 - k * 0.7) + WIND.x * k * k * s * 0.9, f.y + 0.15 + k * f.h * s, f.z + f.oz * s * (1 - k * 0.7) + WIND.z * k * k * s * 0.9);
      const size = f.sz * s * Math.pow(1 - k, 0.7) * (0.75 + 0.25 * Math.sin(t * 17 + f.rot));
      q.setFromEuler(e.set(0, f.rot + t * 1.5, 0));
      fm.setMatrixAt(i, m.compose(p, q, sc.set(size, size * 1.35, size)));
      if (k < 0.3) c.copy(HOT).lerp(MID, k / 0.3); else c.copy(MID).lerp(END, (k - 0.3) / 0.7);
      fm.setColorAt(i++, c.multiplyScalar(1 - k * 0.5));
    }
    for (const f of embers) {
      const k = frac(t * f.sp + f.ph), s = f.s;
      p.set(f.x + f.ox * s + WIND.x * k * 10 * s + Math.sin(k * 19 + f.w) * 0.5, f.y + 0.8 + k * 13 * s, f.z + f.oz * s + WIND.z * k * 10 * s + Math.cos(k * 15 + f.w) * 0.5);
      const size = 0.09 * (1 - k * 0.6) * (Math.sin(t * 23 + f.w * 5) > -0.3 ? 1 : 0.25);
      fm.setMatrixAt(i, m.compose(p, q.identity(), sc.set(size, size, size)));
      fm.setColorAt(i++, c.setRGB(8, 3.4, 0.9).multiplyScalar(1 - k));
    }
    fm.instanceMatrix.needsUpdate = true; fm.instanceColor.needsUpdate = true;
    puffs.forEach((f, j) => {
      const k = frac(t * f.sp + f.ph), s = f.s;
      const drift = k * k * 15 * s;
      p.set(f.x + f.ox * s + WIND.x * drift, f.y + 1.6 * s + k * 17 * s, f.z + f.oz * s + WIND.z * drift);
      const size = s * f.v * (0.7 + 3.6 * k) * Math.min(1, k / 0.06) * (1 - Math.max(0, (k - 0.78) / 0.22));
      q.setFromEuler(e.set(0, 0, f.rot + t * 0.2 * (f.v - 1)));                  // spin in the view plane (billboard)
      sm.setMatrixAt(j, m.compose(p, q, sc.set(size * 1.3, size * 1.3, 1)));
      c.copy(SMOKE_LO).lerp(SMOKE_HI, Math.min(1, k * 1.4));
      const glow = Math.max(0, 1 - k / 0.18);
      c.r += GLOW.r * glow; c.g += GLOW.g * glow; c.b += GLOW.b * glow;
      sm.setColorAt(j, c);
    });
    sm.instanceMatrix.needsUpdate = true; sm.instanceColor.needsUpdate = true;
  };
}

// ---------------------------------------------------------------- camp ring (south + flanks)
function camp(b, r, gateX) {
  const inArc = (a) => Math.cos(a) < 0.45;                              // a = angle from +Z; skip the castle side
  // palisade of sharpened stakes
  for (let a = 0; a < Math.PI * 2; a += 0.0105) {
    if (!inArc(a) || r.chance(0.07)) continue;
    const R = 64 + Math.sin(a * 5) * 2.5, x = Math.sin(a) * R, z = Math.cos(a) * R, hh = r.range(2.3, 3.1);
    b.push({ s: [0.34, hh, 0.34], p: [x, hh / 2, z], r: [r.range(-0.08, 0.08), a, r.range(-0.1, 0.1)], c: shade(0x5a3d2a, r.range(0.75, 1.1)) });
    b.push({ s: [0.2, 0.35, 0.2], p: [x, hh + 0.15, z], c: shade(0x6e4c34, r.range(0.8, 1.1)) });
    if (r.chance(0.2)) b.push({ s: [0.22, 0.22, 2.2], p: [x, 1.2, z], r: [0, a + Math.PI / 2, 0], c: 0x3e2a1d });
  }
  // tents beyond the palisade
  for (let i = 0; i < 16; i++) {
    const a = Math.PI * (0.62 + r.range(-0.36, 0.36) + (i % 2 ? 0.5 : -0.5) * r.range(0, 0.4)) + (i < 8 ? 0 : Math.PI);
    if (!inArc(a)) continue;
    const R = r.range(72, 98), x = Math.sin(a) * R, z = Math.cos(a) * R;
    const col = r.chance(0.5) ? 0x8a3025 : 0xb09a7c, w = r.range(4, 6), d = r.range(4.5, 7);
    for (let k = 0; k < 5; k++) b.push({ s: [w * (1 - k * 0.19), 0.7, d], p: [x, 0.35 + k * 0.7, z], r: [0, a, 0], c: shade(col, 1 - k * 0.04) });
    b.push({ s: [0.2, 4.6, 0.2], p: [x, 2.3, z], c: 0x3a2618 });
  }
  // cheval-de-frise barricades at the arena rim (not on the gate road)
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + r.range(-0.1, 0.1);
    const x = Math.sin(a) * r.range(49, 53), z = Math.cos(a) * r.range(49, 53);
    if (z > 30 && Math.abs(x - gateX) < 14) continue;
    const yaw = a + Math.PI / 2 + r.range(-0.3, 0.3);
    b.push({ s: [5, 0.34, 0.34], p: [x, 0.55, z], r: [0, yaw, 0], c: 0x4a3222 });
    for (let k = 0; k < 5; k++) {
      const ox = (k - 2) * 1.1, cx = x + Math.cos(yaw) * ox, cz = z - Math.sin(yaw) * ox;
      b.push({ s: [0.16, 2.2, 0.16], p: [cx, 0.8, cz], r: [0.75, yaw, 0], c: 0x5e4330 }, { s: [0.16, 2.2, 0.16], p: [cx, 0.8, cz], r: [-0.75, yaw, 0], c: 0x5e4330 });
    }
  }
  // crates and spear racks near the rim
  for (let i = 0; i < 26; i++) {
    const a = r.range(0, Math.PI * 2);
    if (!inArc(a)) continue;
    const R = r.range(55, 62), x = Math.sin(a) * R, z = Math.cos(a) * R, s = r.range(0.7, 1.1);
    b.push({ s: [s, s, s], p: [x, s / 2, z], r: [0, r.range(0, 3), 0], c: shade(0x6e5038, r.range(0.8, 1.1)) });
    if (r.chance(0.5)) b.push({ s: [s * 0.8, s * 0.8, s * 0.8], p: [x + 0.2, s + s * 0.4, z], r: [0, r.range(0, 3), 0], c: shade(0x5a4030, r.range(0.8, 1.1)) });
  }
}

export function buildDressing(scene, { wallZ, gateX, castle, fieldFires }) {
  const r = makeRng(44);
  const poles = [], cloths = [];
  // sunlight through the cloth: emissive = the banner's own texture, so 魏/蜀 read even when backlit
  const cm = (map, alpha = true) => new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0.22, side: THREE.DoubleSide, alphaTest: alpha ? 0.5 : 0, roughness: 0.92, flatShading: true });
  const mats = {
    wei: cm(bannerTexture('魏', { bg: '#7d2a1f', fg: '#1a0d0a', border: '#4a1712', seed: 3 })),
    shu: cm(bannerTexture('蜀', { bg: '#c7a574', fg: '#2a120a', border: '#8e2a1c', w: 192, h: 256, seed: 5 })),
    shuFlag: cm(bannerTexture('蜀', { bg: '#b89668', fg: '#2a120a', border: '#9a2e1e', w: 128, h: 96, tatter: false, seed: 6 }), false),
    red: cm(bannerTexture('', { bg: '#a3321f', fg: '#000', border: '#6a1c12', w: 64, h: 128, seed: 7 })),
  };
  const addCloth = (mat, w, h, kind, x, y, z, yaw) => {
    const c = cloth(mat, w, h, kind, r.range(0, 6.28));
    c.position.set(x, y, z); c.rotation.y = yaw;
    scene.add(c); cloths.push(c);
    return c;
  };
  /** Wei standard: pole + crossbar, cloth hangs from the bar; faces the arena centre. */
  const standard = (x, z, s = 1, mat = mats.wei, P = 8.5 * s) => {
    const W = 2.3 * s, Hc = 4.3 * s;
    const yaw = Math.atan2(-x, -z) + r.range(-0.35, 0.35);                 // cloth plane faces the centre
    const cx = Math.cos(yaw), cz = -Math.sin(yaw);
    poles.push({ s: [0.2 * s, P, 0.2 * s], p: [x, P / 2, z], c: 0x3b2a1e });
    poles.push({ s: [W + 0.5, 0.16 * s, 0.16 * s], p: [x + cx * (W / 2), P - 0.3 * s, z + cz * (W / 2)], r: [0, yaw, 0], c: 0x3b2a1e });
    poles.push({ s: [0.14, 0.5, 0.14], p: [x + cx * (W + 0.25), P - 0.3 * s, z + cz * (W + 0.25)], c: 0x6b5a2a });
    poles.push({ s: [0.12, 0.8 * s, 0.12], p: [x, P + 0.4 * s, z], c: 0xb8b0a0 });
    addCloth(mat, W, Hc, 'hang', x + cx * 0.12, P - 0.4 * s, z + cz * 0.12, yaw);
  };
  // Wei standards around the arena rim and along the camp palisade (outside the fighting area)
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + r.range(-0.08, 0.08);
    if (Math.cos(a) > 0.62) continue;                                    // keep the castle view clear
    const R = i % 2 ? r.range(47, 52) : r.range(58, 62);
    standard(Math.sin(a) * R, Math.cos(a) * R, r.range(0.95, 1.25), r.chance(0.15) ? mats.red : mats.wei);
  }
  // the flank toward the watchtowers: a cluster of big standards (concept left side)
  for (const [x, z, s] of [[40, 30, 1.35], [47, 22, 1.2], [36, 40, 1.1], [52, 34, 1.25]]) standard(x, z, s);
  // castle arc: the siege line of standards just outside the arena (R 47-57, never between a wall-facing camera and
  // the hero), cloth at ≈ 2.7-7 m so it sits inside the gameplay frame's top band; clear of the gate and the 蜀 drape
  for (const [x, z, s, red] of [[-57, 10, 1.1], [-51, 21, 1.05], [-43, 30, 1, 1], [-33, 39, 1.1], [-2, 48, 1.05], [8, 49, 1], [24.5, 42, 1.1], [36, 33, 1.05, 1]]) {
    standard(x, z, s, red ? mats.red : mats.wei, 7.3 * s);
  }
  // … and a few out on the open flank beside the watchtowers (the sun gap and the tower cabins stay clear)
  for (const [x, z, s] of [[52, 74, 1.25], [62, 58, 1.2], [74, 70, 1.3]]) standard(x, z, s);
  // 蜀: great banner draped on the wall beside the gate, flags along the wall walk, towers
  addCloth(mats.shu, 7.5, 9.5, 'drape', gateX - 18 + 3.75, castle.H - 0.3, wallZ - 0.35, Math.PI);   // faces the arena (-Z)
  poles.push({ s: [8.6, 0.35, 0.35], p: [gateX - 18, castle.H - 0.15, wallZ - 0.4], c: 0x3b2a1e });
  const flag = (x, y, z, h = 3.2, mat = mats.shuFlag) => {
    poles.push({ s: [0.12, h + 1.4, 0.12], p: [x, y + (h + 1.4) / 2, z], c: 0x3b2a1e });
    addCloth(mat, 1.9, 1.3, 'flag', x, y + h + 1.3, z, Math.atan2(-WIND.z, WIND.x));
  };
  for (let x = -150; x < castle.x1 - 4; x += 16) if (Math.abs(x - gateX) > 12) flag(x + r.range(-2, 2), castle.H, wallZ + 0.8);
  flag(gateX - 7, castle.H + 0.6, wallZ + 1, 9);
  flag(gateX + 7, castle.H + 0.6, wallZ + 1, 9);
  flag(castle.cornerX + 4, castle.towerH, wallZ - 0.5, 4, mats.red);
  for (const [x, z, h, s] of castle.towers) flag(x + 1.4 * s, h + 1, z - 1.4 * s, 3, mats.red);

  // Wei reserve army massed beyond the palisade, out to the haze (instanced, idle bob) — "troops to the horizon"
  const troops = [];
  for (let f = 0; f < 26; f++) {
    const a = r.range(0, Math.PI * 2), R = r.range(76, 170), cx = Math.sin(a) * R, cz = Math.cos(a) * R, face = Math.atan2(-cx, -cz);
    if (Math.cos(a) > 0.35 && cx < castle.x1 + 22) continue;               // none behind the wall; the open flank is fair
    const cols = r.int(8, 16), rows = r.int(5, 10);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const lx = (i - cols / 2) * 1.3 + r.range(-0.2, 0.2), lz = (j - rows / 2) * 1.4 + r.range(-0.2, 0.2);
      troops.push({ x: cx + lx * Math.cos(face) + lz * Math.sin(face), z: cz - lx * Math.sin(face) + lz * Math.cos(face), yaw: face + r.range(-0.2, 0.2), ph: r.range(0, 6.28) });
    }
    if (r.chance(0.6)) standard(cx, cz, r.range(1.0, 1.3));
  }
  const army = new THREE.InstancedMesh(figureGeometry(), lit(), troops.length);
  army.name = 'reserve-army';
  scene.add(army);
  const am = new THREE.Matrix4(), aq = new THREE.Quaternion(), ap = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  const poseArmy = (t) => {
    troops.forEach((s, i) => army.setMatrixAt(i, am.compose(ap.set(s.x, Math.max(0, Math.sin(t * 2.2 + s.ph)) * 0.06, s.z), aq.setFromAxisAngle(up, s.yaw), one)));
    army.instanceMatrix.needsUpdate = true;
  };

  // fallen standards lying in the dirt (flat, never occlude)
  const fallenMat = new THREE.MeshStandardMaterial({ map: mats.wei.map, color: 0x9a8a80, side: THREE.DoubleSide, alphaTest: 0.5, roughness: 0.95 });   // trampled, dusty
  for (let i = 0; i < 7; i++) {
    const a2 = r.range(0, 6.28), d = r.range(12, 42), x = Math.sin(a2) * d, z = Math.cos(a2) * d, yaw = r.range(0, 6.28);
    const c = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 4.3, 3, 4), fallenMat);
    c.rotation.set(-Math.PI / 2, 0, yaw); c.position.set(x, 0.14, z); c.receiveShadow = true;
    scene.add(c);
    poles.push({ s: [0.2, 0.2, 6], p: [x + Math.cos(yaw) * 1.6, 0.12, z - Math.sin(yaw) * 1.6], r: [0, yaw + 0.15, 0], c: 0x3b2a1e });
  }
  // drifting dust banks (soft sprites): along the wall foot, around the arena rim and over the camp — backlit haze
  const dc = document.createElement('canvas'); dc.width = dc.height = 64;
  const dg = dc.getContext('2d'), grd = dg.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.45)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  dg.fillStyle = grd; dg.fillRect(0, 0, 64, 64);
  const dustTex = new THREE.CanvasTexture(dc);
  const dusts = [];
  for (let i = 0; i < 34; i++) {
    const wall = i < 14, a = r.range(0, Math.PI * 2), R = r.range(52, 90);
    const x = wall ? r.range(-80, castle.x1) : Math.sin(a) * R, z = wall ? wallZ - r.range(3, 12) : Math.cos(a) * R;
    if (!wall && Math.cos(a) > 0.5) continue;
    // wall-foot banks kept thin: the stone coursing, ladders and banners must read through them
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: dustTex, color: wall ? 0xc89c80 : 0xb08c7c, transparent: true, opacity: wall ? r.range(0.035, 0.07) : r.range(0.08, 0.16), depthWrite: false }));
    const w = r.range(14, 26);
    sp.scale.set(w, w * r.range(0.3, 0.45), 1);
    sp.position.set(x, w * 0.12, z);
    sp.userData = { x, ph: r.range(0, 6.28), sp: r.range(0.2, 0.5) };
    scene.add(sp); dusts.push(sp);
  }

  const props = [];
  camp(props, r, gateX);
  // battle debris, all low so nothing blocks the fight: arrow volleys stuck in the ground, wrecked carts under the
  // field fires, rubble at the wall foot
  for (let c = 0; c < 26; c++) {
    const a = r.range(0, 6.28), d = r.range(8, 44), cx = Math.sin(a) * d, cz = Math.cos(a) * d, tilt = r.range(0.2, 0.5), dir = r.range(-0.4, 0.4) + 2.5;
    for (let k = 0; k < r.int(5, 12); k++) {
      const x = cx + r.range(-1.6, 1.6), z = cz + r.range(-1.6, 1.6);
      props.push({ s: [0.035, 0.85, 0.035], p: [x, 0.3, z], r: [tilt, dir, 0], c: 0x4a3524 }, { s: [0.09, 0.14, 0.02], p: [x + Math.sin(dir) * Math.sin(tilt) * 0.4, 0.3 + Math.cos(tilt) * 0.4, z + Math.cos(dir) * Math.sin(tilt) * 0.4], r: [tilt, dir, 0], c: 0xd8cfc0 });
    }
  }
  for (const [x, , z, s] of fieldFires) {
    const yaw = r.range(0, 3);
    props.push({ s: [1.6 * s, 0.14, 2.6 * s], p: [x + 0.4, 0.55, z], r: [0.35, yaw, 0.2], c: 0x2a1a10 });
    for (const o of [-1, 1]) props.push({ s: [0.16, 1.1 * s, 1.1 * s], p: [x + Math.cos(yaw) * o * 0.9 * s, 0.5 * s, z - Math.sin(yaw) * o * 0.9 * s], r: [0, yaw, 0.4 * o], c: 0x241610 });
  }
  for (let i = 0; i < 90; i++) {
    const x = r.range(-110, castle.x1), s = r.range(0.3, 0.9);
    if (Math.abs(x - gateX) < 7) continue;
    props.push({ s: [s, s * r.range(0.5, 1), s], p: [x, s * 0.35, wallZ - r.range(0.6, 3.5)], r: [r.range(-0.3, 0.3), r.range(0, 3), r.range(-0.3, 0.3)], c: shade(0x5e4e4c, r.range(0.75, 1.15)) });
  }
  const poleMesh = new THREE.Mesh(boxesGeometry(poles.concat(props)), lit());
  poleMesh.castShadow = true; poleMesh.receiveShadow = true;
  scene.add(poleMesh);

  // fires: castle braziers/burning gate + field fires at the arena rim (burning barricades/carts)
  const fireSpots = [...castle.fires, ...fieldFires];
  const logs = [];
  for (const [x, y, z, s] of fireSpots) {
    logs.push({ s: [1.8 * s, 0.32 * s, 0.32 * s], p: [x, y + 0.16 * s, z], r: [0, 0.5, 0], c: 0x241510 }, { s: [1.8 * s, 0.32 * s, 0.32 * s], p: [x, y + 0.36 * s, z], r: [0, -0.7, 0], c: 0x2e1c10 });
    logs.push({ s: [0.6 * s, 0.12, 0.6 * s], p: [x, y + 0.08, z], c: 0xff9a3a });
  }
  scene.add(new THREE.Mesh(boxesGeometry(logs), lit()));
  // far-off burning (camp, flanks, inside the castle) at 110-150 m: big bonfires that put warm points of fire into the
  // hazy mauve band behind the fight — a battlefield ablaze to the horizon. Off the sun's bearing and the gate view;
  // not in world.fires (vfx embers spawn at those).
  const farFires = [[-45, 0, -112, 3.2], [38, 0, -150, 3.6], [-100, 0, -88, 3], [-128, 0, 22, 3.4], [112, 0, -34, 3.2], [-62, 0, 88, 3.4]];
  const updateFire = fireSystem(scene, fireSpots.concat(farFires));
  // world.fires contract (vfx embers read .position of ground-level fires)
  const fires = fireSpots.filter((f) => f[1] < 1).map(([x, y, z]) => ({ position: new THREE.Vector3(x, y, z) }));

  return {
    fires,
    update(t) {
      for (const c of cloths) animateCloth(c, t);
      updateFire(t);
      poseArmy(t);
      for (const d of dusts) d.position.x = d.userData.x + Math.sin(t * 0.05 * d.userData.sp + d.userData.ph) * 4 + WIND.x * ((t * d.userData.sp) % 8);
    },
  };
}
