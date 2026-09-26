// Musou presentation (render-only; reads game.musou / hero state, never writes sim state):
//  · grade (display space, DOM layers between the canvas and the HUD, so ACES can't swallow them): 1–2 frame flash, a
//    cold teal-night dim that lifts during the chase run, a screen-blended teal-white burst at contact and at the
//    finisher (1–2 frame peak, no hold, so the launched bodies keep their contrast); radial light rays at
//    contact as an additive HDR quad (bloom + retro dither like everything else), depth-tested behind the contact point;
//    a brief teal fill light on the camera side of the fan; the cool tint bridges the dark intro into the contact and is
//    gone within 0.5 s, so the payoff plays at the normal golden-hour contrast.
//  · floating light motes (streak during the chase), rising energy ribbons, electric aura in the close-up
//  · the voxel azure dragon (path shared with the sim hits: dragonAt), shedding light-voxel shards, dissolving at the end
//  · finisher lightning ring band (DW9 ring wave), calligraphy cut-in (無雙 + seal) over the close-up (DOM, frame-driven)
import * as THREE from 'three';
import { on } from '../core/events.js';
import { vrng, hash01 } from '../core/rng.js';
import { MUSOU, dragonAt, dragonArc } from './musou.js';

const _m = new THREE.Matrix4(), _l = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _v = new THREE.Vector3(), _c = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0), UP = new THREE.Vector3(0, 1, 0), FWD = new THREE.Vector3(0, 0, 1);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ramp = (t, a, b) => clamp01((t - a) / (b - a));

/** Box geometry with baked per-face shade (top bright, bottom dark) so flat-coloured voxels still read as solids. */
function shadedBox() {
  const g = new THREE.BoxGeometry(1, 1, 1), n = g.attributes.normal, col = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) {
    const k = n.getY(i) > 0.5 ? 1 : n.getY(i) < -0.5 ? 0.42 : Math.abs(n.getX(i)) > 0.5 ? 0.72 : 0.86;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function instanced(scene, geo, mat, n) {
  const m = new THREE.InstancedMesh(geo, mat, n);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.frustumCulled = false; m.visible = false;
  for (let i = 0; i < n; i++) { m.setMatrixAt(i, ZERO); m.setColorAt(i, _c.setRGB(1, 1, 1)); }
  scene.add(m);
  return m;
}

// ---------------------------------------------------------------- dragon layout
const NS = 46, SP = 0.3, NECK = 1.1, GIRTH = 1.4;        // body segments, spacing (m), head→first segment gap, body scale
// (r2: girth ×1.4 and a bigger head — from the flank payoff camera the dragon runs 8–14 m away and read as a thin ribbon)
const COL = {
  // azure 青龍: saturated enough that ACES keeps the hue; only fins/belly/whiskers/eyes run hot enough to bloom
  // (r2: fins/belly/white a notch lower — the post's cool-biased bloom turned the finisher coil into a white column)
  body: [0.03, 0.2, 0.75], scale: [0.06, 0.38, 1.05], belly: [0.4, 0.72, 0.92], fin: [0.42, 0.95, 1.3], eye: [3.0, 2.2, 0.5],
  horn: [1.4, 1.15, 0.6], white: [1.0, 1.12, 1.2], whisker: [0.6, 1.15, 1.55],
};
function dragonParts() {
  const parts = [];            // { seg (-1 head), off, size, dir?, col, dyn? }
  const add = (seg, off, size, col, dir, dyn) => parts.push({ seg, off, size, col, dir, dyn });
  for (let k = 0; k < NS; k++) {
    const u = k / (NS - 1), w = GIRTH * (k < 4 ? 0.52 + k * 0.05 : 0.14 + 0.58 * Math.pow(1 - (k - 4) / (NS - 4), 0.75));
    add(k, [0, 0, 0], [w, w * 0.86, SP * 1.4], k % 2 ? COL.scale : COL.body);
    add(k, [0, -w * 0.42, 0], [w * 0.72, w * 0.26, SP * 1.25], COL.belly);
    if (u < 0.93) add(k, [0, w * 0.52, -SP * 0.1], [w * 0.16, w * (k % 2 ? 0.42 : 0.72), SP * 0.6], COL.fin, [0, 0.5, -1]);
    if (k === 5 || k === 21) for (const sx of [1, -1]) {                           // legs with claws
      add(k, [sx * w * 0.62, -w * 0.3, 0], [0.18, 0.18, 0.62], COL.body, [sx * 0.7, -0.8, -0.5]);
      add(k, [sx * w * 0.95, -w * 0.72, -0.12], [0.34, 0.1, 0.28], COL.white);
    }
  }
  for (const [x, dy] of [[0, 0.3], [0.12, 0.12], [-0.12, 0.12]]) add(NS - 1, [x, dy, -0.25], [0.05, 0.42, 0.34], COL.fin, [x * 3, 1, -1.2]);
  const H = -1;
  add(H, [0, 0.05, 0], [0.64, 0.52, 0.64], COL.scale);
  add(H, [0, 0.31, 0.12], [0.68, 0.12, 0.32], COL.fin);
  add(H, [0, -0.02, 0.56], [0.46, 0.3, 0.62], COL.body);
  add(H, [0, 0.09, 0.88], [0.3, 0.14, 0.12], COL.white);
  add(H, [0, -0.2, 0.62], [0.4, 0.06, 0.46], COL.white);
  add(H, [0, -0.36, 0.44], [0.4, 0.12, 0.64], COL.body, null, 'jaw');
  add(H, [0, -0.28, 0.48], [0.34, 0.05, 0.42], COL.white, null, 'jaw');
  for (const sx of [1, -1]) {
    add(H, [sx * 0.27, 0.19, 0.22], [0.09, 0.11, 0.15], COL.eye);
    add(H, [sx * 0.2, 0.52, -0.46], [0.09, 0.09, 0.8], COL.horn, [sx * 0.25, 0.6, -1]);
    add(H, [sx * 0.27, 0.72, -0.62], [0.07, 0.07, 0.3], COL.horn, [sx * 0.2, 1, -0.1]);
    add(H, [sx * 0.62, -0.08, 0.58], [0.035, 0.035, 1.1], COL.whisker, [sx * 0.9, -0.1, -0.5], 'whisker');
  }
  for (let j = 0; j < 5; j++) { const x = (j - 2) * 0.14; add(H, [x, 0.12 + (2 - Math.abs(j - 2)) * 0.06, -0.52], [0.07, 0.2, 0.6], COL.fin, [x * 2, 0.35, -1]); }   // mane
  add(H, [0, -0.52, 0.2], [0.2, 0.05, 0.42], COL.white, [0, -0.5, -1]);
  return parts;
}
const HEAD_SCALE = 2.3;

export function createMusouView(scene, game, camera) {
  const mu = game.musou, hero = game.hero;
  const addMat = () => new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });

  // ---- grade quads
  const addU = { uC: { value: new THREE.Vector2(0.5, 0.5) }, uRays: { value: 0 }, uTime: { value: 0 }, uAspect: { value: 16 / 9 }, uDepth: { value: -1 },
    uCol: { value: new THREE.Color(0.42, 0.95, 1.25) } };
  // fullscreen triangle; uDepth: NDC depth of the quad; depth-tested, so whatever stands in front of it (launched bodies)
  // cuts out as a silhouette
  const addGeo = new THREE.BufferGeometry();
  addGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const add = new THREE.Mesh(addGeo, new THREE.ShaderMaterial({ uniforms: addU, depthWrite: false, transparent: true, fog: false,
    blending: THREE.AdditiveBlending,
    vertexShader: 'uniform float uDepth; varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, uDepth, 1.0); }',
    fragmentShader: `
    uniform vec2 uC; uniform float uRays, uTime, uAspect; uniform vec3 uCol; varying vec2 vUv;
    void main() {
      vec2 p = vUv - uC; p.x *= uAspect;
      float r = length(p), a = atan(p.y, p.x + 1e-5);                      // (pow bases clamped: pow(<0) is NaN → bloom smears it)
      float ray = pow(max(0.0, 0.5 + 0.5 * sin(a * 19.0 + uTime * 0.9)), 6.0) + 0.8 * pow(max(0.0, 0.5 + 0.5 * sin(a * 31.0 - uTime * 1.6 + 1.7)), 9.0)
                + 0.6 * pow(max(0.0, 0.5 + 0.5 * sin(a * 7.0 + 2.3 + uTime * 0.3)), 4.0);
      float core = exp(-r * r * 60.0);
      float rays = ray * smoothstep(0.05, 0.3, r) * (1.0 - 0.45 * clamp(r, 0.0, 1.0)) + core * 0.8;
      gl_FragColor = vec4(uCol * uRays * rays, 1.0);
    }` }));
  add.frustumCulled = false; add.renderOrder = 1e6 + 1; add.visible = false;
  scene.add(add);
  const layer = (blend) => { const d = document.createElement('div'); d.style.cssText = `position:fixed;inset:0;pointer-events:none;opacity:0;mix-blend-mode:${blend}`; return d; };
  const dimEl = layer('multiply'), washEl = layer('screen');
  (document.getElementById('c') || document.body.firstChild).after(dimEl, washEl);     // above the canvas, below the HUD

  // ---- light voxels: motes | ribbons | aura | ring wall
  const NM = 220, NH = 72, NA = 48, NR = 144, H0 = NM, A0 = NM + NH, R0 = A0 + NA;
  // r3: depth-writing, so the post's depth-driven DOF blurs each light voxel by its own depth: without it they took the
  // depth of whatever lay behind them (far crowd, sky) and every mote / aura crackle / ring voxel became a max-size soft
  // disc (the intro's bokeh blobs, the close-up's blue smears)
  const fx = instanced(scene, new THREE.BoxGeometry(1, 1, 1), Object.assign(addMat(), { depthWrite: true }), R0 + NR);

  // ---- light-voxel shards (dragon trail, contact/finisher bursts, musou KOs)
  const NSH = 700;
  const sh = { m: instanced(scene, new THREE.BoxGeometry(1, 1, 1), Object.assign(addMat(), { depthWrite: true }), NSH), next: 0,   // (r3: depth for the DOF, as fx)
    x: new Float32Array(NSH * 3), v: new Float32Array(NSH * 3), life: new Float32Array(NSH), max: new Float32Array(NSH), size: new Float32Array(NSH), rot: new Float32Array(NSH) };
  const shard = (x, y, z, vx, vy, vz, life, size, r, g, b) => {
    const i = sh.next; sh.next = (sh.next + 1) % NSH;
    sh.x[i * 3] = x; sh.x[i * 3 + 1] = y; sh.x[i * 3 + 2] = z; sh.v[i * 3] = vx; sh.v[i * 3 + 1] = vy; sh.v[i * 3 + 2] = vz;
    sh.life[i] = sh.max[i] = life; sh.size[i] = size; sh.rot[i] = vrng.range(0, 6.3);
    sh.m.setColorAt(i, _c.setRGB(r, g, b)); sh.m.instanceColor.needsUpdate = true; sh.m.visible = true;
  };
  const burst = (x, y, z, n, spd, up, size = 0.12, k = 1) => {
    for (let i = 0; i < n; i++) {
      const a = vrng.range(0, 6.283), s = spd * vrng.range(0.3, 1), w = vrng.range(0.6, 1.1) * k;
      shard(x, y, z, Math.cos(a) * s, vrng.range(0.2, 1) * up, Math.sin(a) * s, vrng.range(0.35, 0.8), size * vrng.range(0.5, 1.3), 0.5 * w, 1.3 * w, 1.9 * w);
    }
  };

  // ---- dragon
  const parts = dragonParts();
  const dragon = instanced(scene, shadedBox(), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }), parts.length);
  const local = parts.map((p) => new THREE.Matrix4().compose(_p.set(...p.off), _q.setFromUnitVectors(FWD, p.dir ? _v.set(...p.dir).normalize() : FWD), _s.set(...p.size)));
  parts.forEach((p, i) => dragon.setColorAt(i, _c.setRGB(...p.col)));
  const bases = Array.from({ length: NS + 1 }, () => new THREE.Matrix4());
  const vis = new Uint8Array(NS + 1), born = new Uint8Array(NS + 1);
  const P3 = [0, 0, 0], Q3 = [0, 0, 0], W3 = [0, 0, 0], V3 = [0, 0, 0];

  // ---- burst light: the contact light fills the launched fan teal from the camera side (always in the scene at 0 so the
  // lit materials compile with it at boot instead of hitching mid-Musou)
  const glow = new THREE.PointLight(0x9fefff, 0, 20, 1.4);
  scene.add(glow);

  // ---- calligraphy cut-in (DOM overlay, frame-driven)
  // integration r1: placed under the HUD's square minimap (ends ≈ 34 vh) and left of the HUD's vertical musou copy
  const css = document.createElement('style');
  css.textContent = `
    .mu-cut { position: fixed; inset: 0; pointer-events: none; z-index: 5; opacity: 0; font-family: "Xingkai SC", "STXingkai", "Libian SC", "Kaiti SC", "STKaiti", serif; }
    .mu-cut .big { position: absolute; right: 11%; top: 36%; writing-mode: vertical-rl; font-size: 18vh; line-height: 1; color: #f7f3ea; transform-origin: 50% 40%;
      text-shadow: 0 0 2px #0b1418, 6px 8px 0 rgba(4,10,14,.55), 0 0 28px rgba(110,220,255,.55); letter-spacing: -1vh; }
    .mu-cut .seal { position: absolute; right: 21.5%; top: 64%; width: 7vh; height: 7vh; background: #a8261b; color: #f3e2c8; border-radius: 0.8vh;
      font: 3.1vh/3.4vh "Kaiti SC", "STKaiti", serif; writing-mode: vertical-rl; display: flex; align-items: center; justify-content: center;
      box-shadow: 0 0 0 0.35vh rgba(243,226,200,.25) inset, 3px 4px 0 rgba(0,0,0,.4); transform-origin: 50% 50%; }
    .mu-cut .sub { position: absolute; right: 22.5%; top: 37%; writing-mode: vertical-rl; font: 3vh/1 "Kaiti SC", "STKaiti", serif; letter-spacing: 1.2vh;
      color: #d8f4ff; text-shadow: 0 0 10px rgba(80,200,255,.7), 2px 2px 0 rgba(0,0,0,.6); }`;
  document.head.appendChild(css);
  const cut = document.createElement('div');
  cut.className = 'mu-cut';
  cut.innerHTML = '<div class="sub">常山 趙子龍</div><div class="big">無雙</div><div class="seal">龍膽</div>';
  document.body.appendChild(cut);
  const [cutSub, cutBig, cutSeal] = cut.children;
  const setStyle = (el, k, v) => { if (el.style[k] !== v) el.style[k] = v; };
  const show = (el, v) => { setStyle(el, 'display', v > 0 ? 'block' : 'none'); setStyle(el, 'opacity', v.toFixed(3)); };   // unused layers leave the compositor

  // ---- events
  let tv = -1, time = 0, startX = 0, startZ = 0;            // tv: musou frame (continues past the end for fades)
  let contactF = -99, burstF = -99;                          // game frames of the payoff events (flashes ignore hitstop)
  on('musou:start', (e) => { tv = 0; startX = e.x; startZ = e.z; });
  on('musou:hit', (e) => { if (e.stage === 'contact') { contactF = game.frame; burst(e.x, e.y, e.z, 45, 11, 7, 0.12, 0.5); } });
  on('musou:burst', (e) => { burstF = game.frame; burst(e.x, 0.6, e.z, 30, 18, 9, 0.12, 0.35); });
  on('ko', (e) => { if (mu.active) for (let i = 0; i < 2; i++) shard(e.x, e.y, e.z, e.dx * 5 + vrng.range(-2, 2), vrng.range(2, 7), e.dz * 5 + vrng.range(-2, 2), vrng.range(0.3, 0.55), vrng.range(0.08, 0.14), 0.4, 1.0, 1.5); });
  on('scenario', () => { tv = -1; sh.life.fill(0); for (let i = 0; i < NSH; i++) sh.m.setMatrixAt(i, ZERO); sh.m.instanceMatrix.needsUpdate = true; });

  function hideAll() {
    add.visible = fx.visible = dragon.visible = false;
    for (const el of [cut, dimEl, washEl]) show(el, 0);
  }

  function updateShards(dt) {
    let any = false;
    for (let i = 0; i < NSH; i++) {
      if (sh.life[i] <= 0) continue;
      sh.life[i] -= dt;
      if (sh.life[i] <= 0) { sh.m.setMatrixAt(i, ZERO); continue; }
      any = true;
      const o = i * 3, dr = Math.max(0, 1 - 2.2 * dt);
      sh.v[o + 1] -= 6 * dt; sh.v[o] *= dr; sh.v[o + 2] *= dr;
      sh.x[o] += sh.v[o] * dt; sh.x[o + 1] = Math.max(0.05, sh.x[o + 1] + sh.v[o + 1] * dt); sh.x[o + 2] += sh.v[o + 2] * dt;
      sh.rot[i] += dt * 9;
      const w = sh.size[i] * Math.min(1, sh.life[i] / sh.max[i] * 2.5);
      _q.setFromAxisAngle(_v.set(0.5, 1, 0.3).normalize(), sh.rot[i]);
      sh.m.setMatrixAt(i, _m.compose(_p.set(sh.x[o], sh.x[o + 1], sh.x[o + 2]), _q, _s.set(w, w, w)));
    }
    sh.m.instanceMatrix.needsUpdate = true;
    if (!any) sh.m.visible = false;
  }

  /** Orthonormal frame at arc length a along the dragon path (world), rolled by `roll`; returns false if unborn. */
  function frameAt(a, roll, M) {
    mu.toWorld(dragonAt(a, P3), W3);
    mu.toWorld(dragonAt(a + 0.08, Q3), V3);
    _z.set(V3[0] - W3[0], V3[1] - W3[1], V3[2] - W3[2]).normalize();
    mu.toWorld(dragonAt(a - 0.08, Q3), V3);
    _z.add(_v.set(W3[0] - V3[0], W3[1] - V3[1], W3[2] - V3[2]).normalize()).normalize();
    _x.crossVectors(UP, _z);
    if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0);
    _x.normalize(); _y.crossVectors(_z, _x);
    const c = Math.cos(roll), s = Math.sin(roll);
    _v.copy(_x).multiplyScalar(c).addScaledVector(_y, s); _y.multiplyScalar(c).addScaledVector(_x, -s); _x.copy(_v);
    M.makeBasis(_x, _y, _z).setPosition(W3[0], W3[1], W3[2]);
  }

  function updateDragon(t, dt) {
    const s = (t - MUSOU.contact) / 60;
    if (s < 0 || s > 1.2) { dragon.visible = false; return; }
    dragon.visible = true;
    const A = dragonArc(s);
    const dissolve = ramp(s, 1.0, (MUSOU.end - MUSOU.contact) / 60);           // tail → head, done at control return
    const alive = Math.round((NS + 1) * (1 - dissolve));                          // j = 0 head, 1..NS body
    for (let j = 0; j <= NS; j++) {
      const a = j ? A - NECK - (j - 1) * SP : A;
      born[j] = a >= 0; vis[j] = born[j] && j < alive;
      if (!born[j]) continue;
      frameAt(a, j ? Math.sin(j * 0.45 - time * 9) * 0.35 : 0, bases[j]);
      // the head grows to full size as it surges off the spear tip (full size right at the chase lens was a white blob)
      if (!j) { const k = HEAD_SCALE * (0.5 + 0.5 * ramp(s, 0.04, 0.22)); bases[j].multiply(_l.makeScale(k, k, k)); }
    }
    // shards: trail off the body, burst where segments dissolve
    const n = Math.round(dt * 60 * 7);
    for (let i = 0; i < n; i++) {
      const j = vrng.int(0, NS);
      if (!vis[j]) continue;
      _p.setFromMatrixPosition(bases[j]);
      shard(_p.x + vrng.range(-0.3, 0.3), _p.y + vrng.range(-0.3, 0.3), _p.z + vrng.range(-0.3, 0.3), vrng.range(-1, 1), vrng.range(0, 1.5), vrng.range(-1, 1),
        vrng.range(0.25, 0.55), vrng.range(0.05, 0.12), 0.2, 0.7, 1.6);
    }
    if (dissolve > 0) for (let j = alive; j < Math.min(NS + 1, alive + 3); j++) {
      if (!born[j]) continue;
      _p.setFromMatrixPosition(bases[j]);
      for (let i = 0; i < 2; i++) shard(_p.x, _p.y, _p.z, vrng.range(-4, 4), vrng.range(0, 5), vrng.range(-4, 4), vrng.range(0.3, 0.55), vrng.range(0.08, 0.16), 0.4, 1.1, 1.7);
    }
    const jaw = 0.18 + 0.22 * Math.max(0, Math.sin(time * 7)), wave = Math.sin(time * 11);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i], j = p.seg + 1;
      if (!vis[j]) { dragon.setMatrixAt(i, ZERO); continue; }
      let L = local[i];
      if (p.dyn === 'jaw') { _q.setFromAxisAngle(_x.set(1, 0, 0), jaw); L = _l.compose(_p.set(p.off[0], p.off[1] - jaw * 0.15, p.off[2]), _q, _s.set(...p.size)); }
      else if (p.dyn === 'whisker') { _q.setFromUnitVectors(FWD, _v.set(p.dir[0], p.dir[1] + wave * 0.4 * Math.sign(p.dir[0]), p.dir[2]).normalize()); L = _l.compose(_p.set(...p.off), _q, _s.set(...p.size)); }
      dragon.setMatrixAt(i, _m.multiplyMatrices(bases[j], L));
    }
    dragon.instanceMatrix.needsUpdate = true;
  }

  function updateFx(t) {
    const M = MUSOU;
    let any = false;
    // motes: frozen-time dust of light around the start point; streak past the camera during the chase run
    // (r3: none in the close-up — 1.7 m from the lens with the focus on his face, every mote 3–8 m behind him was a
    // max-size DOF disc; they switch off/on exactly on the hard cuts)
    const moteK = t >= M.closeup && t < M.chase ? 0 : ramp(t, 1, 5) * (1 - ramp(t, M.chase + 4, M.chase + 20));
    const streak = ramp(t, M.chase, M.chase + 6) * 7;
    const cam = camera.position, dist = (x, y, z) => Math.hypot(x - cam.x, y - cam.y, z - cam.z);
    const near = (x, y, z) => ramp(dist(x, y, z), 0.9, 2.2);                                       // no blocks in the lens
    const hy = hero.yaw, still = t < M.chase;
    for (let i = 0; i < NM; i++) {
      if (moteK <= 0) { fx.setMatrixAt(i, ZERO); continue; }
      const r = 0.6 + 7.5 * Math.pow(hash01(i, 11), 1.6), a = hash01(i, 12) * 6.283;
      const y = ((hash01(i, 13) * 3.8 + time * (0.12 + 0.1 * hash01(i, 14))) % 3.8) + 0.1;
      const x = startX + Math.cos(a) * r + Math.sin(time * 0.7 + i) * 0.15, z = startZ + Math.sin(a) * r;
      // r3: frozen-time motes are small crisp specks (DW8 anchor), not bokeh: nothing within 2.5 m of the lens (DOF + bloom
      // turned near motes into big white discs that lifted the dark intro to 1.3× gameplay luma), ≤ 3 cm, below bloom level
      const w = (still ? 0.018 + 0.012 * hash01(i, 15) : 0.025 + 0.03 * hash01(i, 15)) * moteK * ramp(dist(x, y, z), 2.5, 4.5);
      _q.setFromAxisAngle(UP, hy);
      fx.setMatrixAt(i, _m.compose(_p.set(x, y, z), _q, _s.set(w, w, w * (1 + streak))));
      const b = still ? 0.55 + 0.25 * hash01(i, 16) : 0.6 + 0.7 * hash01(i, 16);
      fx.setColorAt(i, _c.setRGB(1.1 * b, 1.25 * b, 1.4 * b));
      any = true;
    }
    // energy ribbons rising around him (pose) + electric aura (close-up)
    const ribK = ramp(t, 2, 8) * (1 - ramp(t, M.closeup - 6, M.closeup));
    for (let i = 0; i < NH; i++) {
      const strand = i % 3, j = (i / 3) | 0, u = ((j / 24 + time * 0.7) % 1);
      if (ribK <= 0) { fx.setMatrixAt(H0 + i, ZERO); continue; }
      const ang = strand * 2.094 + u * 7 + time * 2.5, rr = 0.8 - 0.25 * u;
      const px = hero.x + Math.cos(ang) * rr, py = 0.1 + u * 2.6, pz = hero.z + Math.sin(ang) * rr, w = 0.036 * ribK * (1 - u * 0.6) * near(px, py, pz);
      fx.setMatrixAt(H0 + i, _m.compose(_p.set(px, py, pz), _q.identity(), _s.set(w, w * 3.2, w)));
      // r3: thin rising streaks just under bloom level (at 1.9 HDR they bloomed into soft blue balls over the dark pose)
      const vio = strand === 2 ? 1 : 0, k = 0.62 * (1.2 - u);
      fx.setColorAt(H0 + i, _c.setRGB((0.35 + vio * 0.6) * k, (0.9 - vio * 0.5) * k, 1.6 * k));
      any = true;
    }
    const auraK = ramp(t, M.closeup, M.closeup + 3) * (1 - ramp(t, M.pullback + 4, M.chase));
    const fr = Math.floor(t / 2);
    for (let i = 0; i < NA; i++) {
      const on = auraK > 0 && hash01(i, fr, 3) < 0.55;
      if (!on) { fx.setMatrixAt(A0 + i, ZERO); continue; }
      // crackle along his silhouette — both shoulders and over the head, in the focal plane (r3: spread round the back of
      // him, 0.5 m behind the face at a 1.7 m focus, every crackle was a big soft DOF blob; in focus they read as arcs)
      const sd = i % 2 ? 1 : -1, a = Math.atan2(cam.x - hero.x, cam.z - hero.z) + sd * Math.PI * (0.46 + 0.14 * hash01(i, fr, 4));
      const yy = 1.05 + hash01(i, fr, 5) * 0.95, rr = (yy > 1.75 ? 0.12 : 0.34) + hash01(i, fr, 6) * 0.22;
      const px = hero.x + Math.sin(a) * rr, pz = hero.z + Math.cos(a) * rr, w = (0.008 + 0.008 * hash01(i, fr, 7)) * near(px, yy, pz);
      _q.setFromAxisAngle(_v.set(Math.sin(a + 1.571), (hash01(i, fr, 8) - 0.5) * 0.6, Math.cos(a + 1.571)).normalize(), (hash01(i, fr, 9) - 0.5) * 2.4);
      fx.setMatrixAt(A0 + i, _m.compose(_p.set(px, yy, pz), _q, _s.set(w, w * (5 + 8 * hash01(i, fr, 10)), w)));
      // just under the bloom knee: brighter and every crackle blooms into a soft blue smear over the face shot
      const e = 0.85 + 0.3 * hash01(i, fr, 11);
      fx.setColorAt(A0 + i, _c.setRGB(0.32 * e, 0.66 * e, 0.92 * e));
      any = true;
    }
    // finisher ring wave: a thin crackling band of light voxels at waist height riding the sim wave front (DW9's
    // horizontal lightning ring). r3: was a 0.5–1.6 m wall of 144 additive columns — bunched in a 2–4 m circle round him
    // and DOF-blurred, it was a teal fog over the first 0.2 s of the finisher that hid Zhao Yun completely
    const w0 = t - M.finisher, ringK = w0 >= 0 ? 1 - ramp(w0, M.waveFrames * 0.7, M.waveFrames + 10) : 0;
    const R = mu.waveR || 1, seg = 6.283 * R / NR * 1.15, fk = Math.floor(t / 2);
    for (let i = 0; i < NR; i++) {
      if (ringK <= 0) { fx.setMatrixAt(R0 + i, ZERO); continue; }
      const a = i / NR * 6.283, px = hero.x + Math.cos(a) * R, pz = hero.z + Math.sin(a) * R;
      const nk = ramp(Math.hypot(px - cam.x, pz - cam.z), 2.5, 6);                 // (the wave passes the camera)
      const py = 0.78 + 0.16 * (hash01(i, fk, 22) - 0.5) + 0.1 * Math.sin(a * 7 + t * 0.5);   // jagged, crackling line
      _q.setFromAxisAngle(UP, -a);
      fx.setMatrixAt(R0 + i, _m.compose(_p.set(px, py, pz), _q, _s.set(0.075 * nk, 0.075 * nk, seg * nk)));
      const rk = ringK * (0.35 + 0.65 * ramp(R, 2, 7)) * (0.75 + 0.5 * hash01(i, fk, 23));
      fx.setColorAt(R0 + i, _c.setRGB(0.75 * rk, 1.6 * rk, 2.1 * rk));
      any = true;
    }
    fx.visible = any;
    fx.instanceMatrix.needsUpdate = true;
    fx.instanceColor.needsUpdate = true;
  }

  function updateGrade(t) {
    const M = MUSOU;
    // dim: +≈20 % flash on the cut frame, full dim 2 frames later (DW8: 1–3 frame flash, dim within 3), lifts during the
    // chase run, then a light cool tint holds through the payoff (teal-white burst instead of the golden sun haze) and
    // warms back to the golden-hour grade as control returns.
    // r3: the dim is a teal-night vignette (display-space multiply) centred on Zhao Yun — ≈0.7× on him, ≈0.27× at the
    // frame edge — so the intro sits at ≈0.6× gameplay luma (DW8 0.52–0.77×) while his ivory lamellar stays readable
    // (the pose shot is ≈1.7× the pre-press gameplay frame undimmed, so the cut frame already carries part of the dim)
    const dim = (t < 1 ? 0.45 : t < 2 ? 0.8 : 1) * (1 - ramp(t, M.chase + 4, M.contact));
    const cool = 0.45 * ramp(t, M.chase + 4, M.contact) * (1 - ramp(t, M.contact + 8, M.contact + 30));   // tint the dark-to-bright cut only, not the payoff
    const mul = (d, c) => Math.round(255 * (1 - dim * (1 - d / 255)) * (1 - cool * (1 - c / 255)));
    const C = [186, 222, 240];
    const rgb = (d) => `rgb(${mul(d[0], C[0])},${mul(d[1], C[1])},${mul(d[2], C[2])})`;
    show(dimEl, dim + cool > 0.003 ? 1 : 0);
    if (dim > 0.003) {
      _p.set(hero.x, t < M.closeup ? 1.1 : 1.5, hero.z).project(camera);
      const hx = (clamp01(_p.x * 0.5 + 0.5) * 100).toFixed(1), hy = ((1 - clamp01(_p.y * 0.5 + 0.5)) * 100).toFixed(1);
      setStyle(dimEl, 'background', `radial-gradient(ellipse 30% 58% at ${hx}% ${hy}%, ${rgb([150, 182, 222])} 0%, ` +
        `${rgb([84, 118, 165])} 55%, ${rgb([48, 72, 112])} 100%)`);
    } else if (cool > 0.003) setStyle(dimEl, 'background', rgb([255, 255, 255]));
    // whiteout: a screen-blended teal-white bloom centred on the burst — lifts the payoff to ≈1.4–1.8× luma while the
    // launched bodies keep their contrast (a 'normal' white layer flattened them into a milky screen)
    const c = t - M.contact, f = t - M.finisher;
    const flashC = game.frame - contactF < 2, flashF = game.frame - burstF < 2;
    const washC = c >= 0 && flashC ? 0.35 : 0, washF = f >= 0 && flashF ? 0.3 : 0;   // 2-frame kick, no hold (a hold veiled the launch fan)
    const flash = t < 1 ? 0.09 : 0;                          // r3: the cut frame only (was 0.2 white for 3 frames: +60–90 %)
    const wash = Math.max(flash, washC, washF);
    // ray centre: contact point, then the finisher (Zhao Yun)
    if (f >= 0) _p.set(hero.x, 1.4, hero.z);
    else { mu.toWorld([0, 1.3, 2.2], W3); _p.set(W3[0], W3[1], W3[2]); }
    _p.project(camera);
    const cx = clamp01(_p.x * 0.5 + 0.5), cy = clamp01(_p.y * 0.5 + 0.5);
    show(washEl, wash);
    if (wash > 0) setStyle(washEl, 'background', flash ? '#fff' :
      `radial-gradient(ellipse at ${(cx * 100).toFixed(1)}% ${((1 - cy) * 100).toFixed(1)}%, rgba(246,255,255,1) 0%, rgba(214,246,250,.75) 30%, rgba(160,214,228,.35) 100%)`);
    // radial rays (HDR, bloom) at contact: the light erupts from inside the crowd (the quad sits 3.5 m past the contact
    // point, so the bodies in front cut out against it). The finisher has none: the dragon coil and the vfx ray burst
    // are its light (full-screen rays + a light pillar on top of them bloomed into a white column that hid Zhao Yun)
    const u = addU;
    u.uRays.value = c >= 0 ? 0.1 * (1 - ramp(c, 4, 28)) : 0;
    add.visible = u.uRays.value > 0.002;
    if (add.visible) {
      u.uC.value.set(cx, cy); u.uAspect.value = camera.aspect; u.uTime.value = time;
      camera.getWorldDirection(_v);
      _p.set(W3[0], W3[1], W3[2]).addScaledVector(_v, 3.5).project(camera);
      u.uDepth.value = Math.min(0.99999, _p.z);
    }
    // burst light on the camera side of the action, so the launched bodies are front-lit teal, not silhouettes
    const gc = c >= 0 && f < 0 ? 1 - ramp(c, 2, 16) : 0;
    glow.intensity = 5 * gc;
    if (glow.intensity > 0) {
      mu.toWorld([0, 1.2, 3.5], W3); _v.set(W3[0], W3[1], W3[2]);
      glow.position.lerpVectors(_v, camera.position, 0.3); glow.position.y = 3.2;
    }
  }

  function updateCut(t) {
    const M = MUSOU;
    const k = ramp(t, M.closeup, M.closeup + 5) * (1 - ramp(t, M.pullback + 2, M.pullback + 10));
    show(cut, k);
    if (k <= 0) return;
    const st = ramp(t, M.closeup, M.closeup + 5), se = ramp(t, M.closeup + 8, M.closeup + 12);
    setStyle(cutBig, 'transform', `scale(${(1.6 - 0.6 * st * st).toFixed(3)}) translateY(${((t - M.closeup) * -0.06).toFixed(2)}vh)`);
    setStyle(cutSeal, 'transform', `scale(${(2.2 - 1.2 * se).toFixed(3)}) rotate(-8deg)`);
    setStyle(cutSeal, 'opacity', se.toFixed(3));
    setStyle(cutSub, 'opacity', ramp(t, M.closeup + 10, M.closeup + 20).toFixed(3));
  }

  let warm = 2;                                              // first renders: draw everything as a no-op so shaders compile at boot, not mid-Musou
  return {
    update(dt) {
      time += dt;
      if (warm > 0 && tv < 0) { warm--; addU.uRays.value = 0; add.visible = fx.visible = dragon.visible = sh.m.visible = true; return; }
      if (mu.active) tv = mu.t;
      else if (tv >= 0) { tv += dt * 60; if (tv > MUSOU.end + 50) tv = -1; }
      if (sh.m.visible) updateShards(dt);
      if (tv < 0) { hideAll(); return; }
      updateGrade(tv);
      updateFx(tv);
      updateDragon(tv, dt);
      updateCut(tv);
    },
  };
}
