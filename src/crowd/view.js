// Crowd renderer (render-only). Voxel Wei soldiers built from shared instanced parts — hips, torso, head, arms,
// thighs, shins — plus per-kind weapons (spear, dao + round shield, captain glaive, 魏 standard) and a separate
// officer set. Per soldier the parts form a small hierarchy (pelvis → torso → head/arms → weapon; pelvis → thigh →
// shin) so knees bend, the torso twists and the weapon follows the hand. Poses come from sim state (walk / march /
// run / guard / wind-up / strike / hurt / knock / air / down / get-up / dead) and are blended per soldier, so nothing
// pops. Instances are packed each frame (count = visible soldiers of that kind). Committed attackers coil into a big
// overhead wind-up (0.67 s) with a pixel-star glint on the weapon tip; a blow that will really come flares a big red
// pixel star for its last 14 sf (a feint keeps the white star). Guards next to a striker
// (crowd.raiseF) brandish their weapons and shout with him. Officers carry a spinning ▼ marker. Never writes sim state.
import * as THREE from 'three';
import { sculpt, shade, boxesGeometry } from '../core/voxel.js';
import { ST, KIND, CROWD } from './crowd.js';
import { patchHitMaterial, hitGlow } from '../combat/hitfx.js';   // hit-impact: victim flash/tint
import { hash01 } from '../core/rng.js';
import { HUD_TAG_R } from '../ui/hud.js';

const V = 0.042;
const b = (a, bb, c, paint) => ({ a, b: bb, c, paint });
// lamellar: 3-voxel rows — dark lacing line, plate body, lit top edge; columns offset per row
const lamel = (base, hi, line) => (x, y, z, i, j) => (j % 3 === 0 ? line : j % 3 === 2 ? hi : ((i + ((j / 3) | 0)) % 2 ? shade(base, 0.86) : base));

const GRUNT = {
  armor: 0x3e3430, hi: 0x6a5a50, lace: 0x1d1513, plate: 0x564842, rivet: 0xa07e4c,
  cloth: 0x5e3026, pants: 0x3a302b, wrap: 0x9a8566, wrapD: 0x5c4c3c, boot: 0x2a1d16,
  skin: 0xd6a07a, skinD: 0xb07e5e, eye: 0x1a1210, brow: 0x2b1b14,
  helm: 0x4a4341, helmHi: 0x8a7d74, band: 0xd0321f, belt: 0x4d3322, buckle: 0xb89040, bracer: 0x3b2a20,
};
const OFFICER = {
  ...GRUNT, armor: 0x2b3350, hi: 0x6a7aa0, lace: 0x141a2c, plate: 0x3e4a70, rivet: 0xe0b450, cloth: 0x4a1a2a,
  pants: 0x23263a, wrap: 0x3a3f5a, wrapD: 0x23263a, helm: 0x2a3150, helmHi: 0xe0b450, belt: 0x6a4a20, buckle: 0xf0c860,
};
const WOOD = 0x5e3d24, STEEL = 0x98968f, RED = 0xc02a1c, BRONZE = 0x9a7838;

// skeleton (soldier space, feet at 0, facing +Z): pelvis 0.86 · waist +0.04 · neck +0.5 · shoulders ±0.235 @ +0.43
// · hips ±0.095 @ -0.02 · knee -0.42 · hand -0.5 from the shoulder
const J = { waist: 0.04, neck: 0.5, shX: 0.235, shY: 0.43, hipX: 0.095, hipY: -0.02, knee: 0.42, hand: 0.5 };

function bodyParts(C, officer) {
  const L = lamel(C.armor, C.hi, C.lace);
  const plate = (x, y, z, i, j) => ((i + j) % 4 === 0 ? C.rivet : j % 4 === 3 ? C.hi : C.plate);
  const pauld = (x, y, z, i, j) => (j === 0 ? C.hi : j % 2 ? C.armor : shade(C.armor, 0.8));
  const p = {};
  p.hips = [
    b([-0.16, -0.1, -0.1], [0.16, 0.06, 0.1], C.pants),
    b([-0.175, -0.01, -0.115], [0.175, 0.07, 0.115], C.belt),
    b([-0.04, 0.0, 0.11], [0.04, 0.07, 0.14], C.buckle),
    b([-0.155, -0.34, 0.095], [0.155, 0.0, 0.14], L),
    b([-0.155, -0.34, -0.14], [0.155, 0.0, -0.095], L),
    b([-0.2, -0.26, -0.09], [-0.15, 0.0, 0.09], C.cloth),
    b([0.15, -0.26, -0.09], [0.2, 0.0, 0.09], C.cloth),
  ];
  p.torso = [
    b([-0.155, -0.04, -0.105], [0.155, 0.2, 0.105], L),
    b([-0.18, 0.18, -0.12], [0.18, 0.46, 0.12], L),
    b([-0.13, 0.24, 0.11], [0.13, 0.42, 0.145], plate),
    b([-0.13, 0.24, -0.145], [0.13, 0.42, -0.11], plate),
    b([-0.3, 0.29, -0.135], [-0.14, 0.47, 0.135], pauld),
    b([0.14, 0.29, -0.135], [0.3, 0.47, 0.135], pauld),
    b([-0.125, 0.44, -0.115], [0.125, 0.5, 0.115], C.cloth),
    b([-0.05, 0.46, -0.05], [0.05, 0.53, 0.05], C.skin),
  ];
  if (officer) p.torso.push(b([-0.21, -0.36, -0.2], [0.21, 0.46, -0.145], (x, y, z, i, j) => (j % 5 === 0 ? 0x7a1e14 : 0xa82c1e)));   // cape
  p.head = [
    b([-0.1, 0.02, -0.09], [0.1, 0.25, 0.11], C.skin),
    b([-0.1, 0.02, 0.06], [0.1, 0.07, 0.11], C.skinD, true),                           // jaw shadow
    b([-0.07, 0.12, 0.1], [-0.03, 0.155, 0.12], C.eye, true), b([0.03, 0.12, 0.1], [0.07, 0.155, 0.12], C.eye, true),
    b([-0.08, 0.16, 0.1], [-0.02, 0.18, 0.12], C.brow, true), b([0.02, 0.16, 0.1], [0.08, 0.18, 0.12], C.brow, true),
    b([-0.015, 0.08, 0.11], [0.02, 0.13, 0.135], C.skinD),                             // nose
    b([-0.125, 0.18, -0.125], [0.125, 0.32, 0.125], C.helm),
    b([-0.08, 0.32, -0.08], [0.08, 0.35, 0.08], C.helmHi),
    b([-0.12, 0.03, -0.13], [0.12, 0.19, -0.08], lamel(C.helm, C.helmHi, shade(C.helm, 0.6))),   // neck guard
    b([-0.13, 0.06, -0.08], [-0.1, 0.19, 0.05], C.helm), b([0.1, 0.06, -0.08], [0.13, 0.19, 0.05], C.helm),
    b([-0.14, 0.18, -0.14], [0.14, 0.23, 0.14], C.band),                               // red headband
    b([-0.05, 0.05, -0.165], [-0.01, 0.2, -0.13], C.band), b([0.01, 0.09, -0.165], [0.05, 0.2, -0.13], C.band),   // knot tails
  ];
  if (officer) {
    p.head.push(
      b([-0.1, 0.0, 0.06], [0.1, 0.08, 0.13], 0x1e1612),                               // beard
      b([-0.25, 0.24, -0.02], [-0.13, 0.4, 0.03], C.helmHi), b([0.13, 0.24, -0.02], [0.25, 0.4, 0.03], C.helmHi),   // wings
      b([-0.035, 0.34, -0.035], [0.035, 0.62, 0.035], RED), b([-0.035, 0.52, -0.2], [0.035, 0.62, -0.03], RED));      // plume
  } else {
    p.head.push(b([-0.035, 0.34, -0.035], [0.035, 0.42, 0.035], RED));                 // red top tassel (reads from above)
  }
  // captain: gilded helmet band + tall horsehair crest (its own small mesh on the head; the body gets a bronze tint)
  p.crest = [
    b([-0.15, 0.175, -0.15], [0.15, 0.235, 0.15], 0xc8a050),
    b([-0.04, 0.34, -0.04], [0.04, 0.66, 0.04], RED), b([-0.04, 0.56, -0.26], [0.04, 0.66, -0.04], RED),
    b([-0.04, 0.4, -0.3], [0.04, 0.56, -0.22], RED)];
  p.arm = [
    b([-0.055, -0.24, -0.06], [0.055, 0.03, 0.06], C.cloth),
    b([-0.06, -0.46, -0.063], [0.06, -0.22, 0.063], (x, y, z, i, j) => (j % 2 ? C.bracer : shade(C.bracer, 1.35))),
    b([-0.045, -0.56, -0.05], [0.045, -0.46, 0.05], C.skin),
  ];
  p.thigh = [b([-0.068, -0.43, -0.072], [0.068, 0.02, 0.072], C.pants)];
  p.shin = [
    b([-0.062, -0.3, -0.066], [0.062, 0.02, 0.066], (x, y, z, i, j) => (j % 3 === 0 ? C.wrapD : C.wrap)),
    b([-0.07, -0.42, -0.078], [0.07, -0.29, 0.13], C.boot),
  ];
  return p;
}

// weapons in weapon space: grip at the origin, +Z along the weapon
const box = (s, p, c) => ({ s, p, c });
function weaponGeos() {
  const spear = boxesGeometry([
    box([0.042, 0.042, 2.0], [0, 0, 0.38], WOOD), box([0.065, 0.065, 0.06], [0, 0, -0.62], 0x2a1d16),
    box([0.07, 0.07, 0.05], [0, 0, 1.4], BRONZE), box([0.1, 0.1, 0.08], [0, -0.02, 1.35], RED), box([0.05, 0.08, 0.08], [0, -0.08, 1.31], RED),
    box([0.085, 0.028, 0.16], [0, 0, 1.5], STEEL), box([0.05, 0.028, 0.12], [0, 0, 1.63], STEEL), box([0.025, 0.028, 0.06], [0, 0, 1.71], STEEL),
  ]);
  const sword = boxesGeometry([
    box([0.045, 0.045, 0.2], [0, 0, -0.02], 0x2a1d16), box([0.06, 0.06, 0.05], [0, 0, -0.14], BRONZE),
    box([0.05, 0.14, 0.04], [0, 0, 0.1], BRONZE),
    box([0.022, 0.085, 0.66], [0, 0.005, 0.45], STEEL), box([0.022, 0.1, 0.12], [0, 0.02, 0.76], STEEL), box([0.022, 0.05, 0.06], [0, 0.05, 0.84], STEEL),
  ]);
  const glaive = boxesGeometry([
    box([0.05, 0.05, 2.3], [0, 0, 0.45], 0x3a2418), box([0.08, 0.08, 0.06], [0, 0, 1.6], BRONZE),
    box([0.14, 0.14, 0.12], [0, 0, 1.52], RED),
    box([0.028, 0.16, 0.5], [0, 0.05, 1.9], STEEL), box([0.028, 0.1, 0.14], [0, 0.11, 2.2], STEEL), box([0.03, 0.06, 0.06], [0, -0.05, 1.7], BRONZE),
  ]);
  const pole = boxesGeometry([
    box([0.055, 0.055, 3.5], [0, 0, 0.9], WOOD), box([1.0, 0.045, 0.045], [0.45, 0, 2.55], WOOD),
    box([0.09, 0.09, 0.14], [0, 0, 2.72], BRONZE), box([0.14, 0.14, 0.12], [0, 0, 2.6], RED),
  ]);
  // round shield strapped to the forearm: centred in front of it, facing +Z of the hand frame
  const R = 0.29;
  const shield = sculpt([b([-R, 0.12 - R, 0.07], [R, 0.12 + R, 0.13], (x, y, z) => {
    const r = Math.hypot(x, y - 0.12);
    if (r > R) return null;
    if (z < 0.1 && r > R - 0.06) return null;                                         // bevel the back
    if (r > R - 0.05) return BRONZE;
    if (r < 0.06) return z > 0.1 ? 0xe0b860 : BRONZE;
    if (Math.abs(r - 0.16) < 0.025) return 0xc8a050;
    return (Math.floor(Math.atan2(x, y - 0.12) / (Math.PI / 4)) & 1) ? 0x7a2418 : 0x5e1a12;
  }), b([-0.07, 0.1, 0.13], [0.07, 0.15, 0.17], 0xe0b860)], V, 0.1);
  return { spear, sword, glaive, pole, shield };
}

/** All crowd geometries. */
function buildCrowdGeometries() {
  const g = {};
  const grunt = bodyParts(GRUNT, false), off = bodyParts(OFFICER, true);
  for (const k of ['hips', 'torso', 'head', 'crest', 'arm', 'thigh', 'shin']) g[k] = sculpt(grunt[k], V, 0.12);
  for (const k of ['hips', 'torso', 'head', 'arm', 'thigh', 'shin']) g['o_' + k] = sculpt(off[k], V, 0.1);
  // grunt shadow proxies: the same solid boxes, un-voxelised (~12 tris each) — the shadow pass never sees the voxel
  // detail. Hips + torso + head share one proxy on the torso matrix.
  const proxy = (boxes, dy = 0) => boxes.filter((q) => !q.paint).map((q) => ({
    s: q.b.map((v, k) => Math.max(0.01, v - q.a[k] - 0.016)), p: q.a.map((v, k) => (v + q.b[k]) / 2 + (k === 1 ? dy : 0)), c: 0 }));
  g.shadow_trunk = boxesGeometry([...proxy(grunt.hips, -J.waist), ...proxy(grunt.torso), ...proxy(grunt.head, J.neck)]);
  for (const k of ['arm', 'thigh', 'shin']) g['shadow_' + k] = boxesGeometry(proxy(grunt[k]));
  Object.assign(g, weaponGeos());
  // officer marker ▼ (voxel rows 7-5-3-1, gold rim around red)
  const tri = [];
  for (let r = 0; r < 4; r++) for (let q = 0; q < 7 - r * 2; q++) {
    const x = (q - (6 - r * 2) / 2) * 0.075, edge = q === 0 || q === 6 - r * 2 || r === 0;
    tri.push(box([0.075, 0.075, 0.09], [x, -r * 0.075, 0], edge ? 0xffd070 : 0xe02a18));
  }
  g.marker = boxesGeometry(tri);
  // glint: a 3-axis pixel star (reads from any camera angle)
  g.glint = boxesGeometry([box([1, 0.12, 0.12], [0, 0, 0], 0xffffff), box([0.12, 1, 0.12], [0, 0, 0], 0xffffff), box([0.12, 0.12, 1], [0, 0, 0], 0xffffff)]);
  return g;
}

function flagTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 112;
  const g = c.getContext('2d');
  g.fillStyle = '#b8301e'; g.fillRect(0, 0, 64, 112);
  g.fillStyle = '#e0b058'; g.fillRect(0, 0, 64, 5); g.fillRect(0, 0, 4, 112); g.fillRect(60, 0, 4, 112);
  g.fillStyle = 'rgba(255,225,180,0.28)'; g.fillRect(10, 16, 44, 60);                  // lighter panel behind the character
  g.fillStyle = '#1a0f0c';
  g.font = 'bold 44px "Xingkai SC","STXingkai","Kaiti SC","STKaiti","KaiTi","Songti SC",serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('魏', 32, 46);
  g.globalCompositeOperation = 'destination-out';                                    // swallow-tail bottom
  g.beginPath(); g.moveTo(14, 112); g.lineTo(32, 88); g.lineTo(50, 112); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

// pose channels (per soldier): torso, head, armR, armL, thighR, thighL (rx,ry,rz) · shinR, shinL (rx) · weapR, weapL (rx,ry,rz)
const TO = 0, HE = 3, AR = 6, AL = 9, TR = 12, TL = 15, SR = 18, SL = 19, WR = 20, WL = 23, NCH = 26;
const GROUP = [0, 1, 2, 3, 2];                  // kind → pose group: 0 spear, 1 sword+shield, 2 glaive, 3 standard-bearer
const TIP = [1.72, 0.86, 2.25, 2.7];             // weapon tip distance along +Z per group
const h01 = (i, k = 0) => (((i + 1) * 2654435761 + k * 40503) >>> 0) / 4294967296;
const legH = (a, bb, rz) => (0.42 * Math.cos(a) + 0.42 * Math.cos(a + bb)) * Math.cos(rz);   // hip → sole height
const smoothstep = THREE.MathUtils.smoothstep;

// ---- recoil pose (hit-impact): the DW flinch. A struck soldier snaps its head back and throws its arms up and back
// within ≈ 2 sf, stumbles with one knee up, holds for ≈ 12 sf, then drops back to guard. There are three variants per
// soldier (both arms flung up and wide / one arm up with a twist / doubled over), mirrored, with jittered amplitude and
// snap speed, so a 15-body band reads as a rippling wave, not clones. Channel values are (rx, ry, rz): torso/head rx < 0
// leans back; arm rx ≈ -2.5 is raised overhead, arm rz pushes it out (right arm < 0, left arm > 0); thigh rx < 0 swings
// the knee forward; shin = knee bend; weapon angles are relative to the hand.
const RECOIL = [
  { // thrown back, both arms flung up and back, one knee kicked up
    TO: [-0.78, 0, 0.06], HE: [-0.75, 0, 0], AR: [-2.4, 0.2, -0.95], AL: [-2.3, -0.2, 1.0],
    TR: [0.32, 0, -0.14], TL: [-0.6, 0, 0.2], SR: 0.2, SL: 1.0, WR: [1.1, 0, 0], WL: [0.5, 0, 0] },
  { // twisted: one arm flung up and back, the other thrown out wide, head turned away
    TO: [-0.62, 0.55, 0.2], HE: [-0.65, -0.35, 0.1], AR: [-2.85, 0, -0.35], AL: [-0.95, 0, 1.35],
    TR: [0.4, 0, -0.18], TL: [-0.35, 0, 0.3], SR: 0.35, SL: 0.7, WR: [1.3, 0, 0], WL: [0.3, 0, 0] },
  { // doubled over the blow, arms thrown forward and out, knees buckling
    TO: [0.72, 0, 0.1], HE: [0.2, 0.25, 0], AR: [-1.35, 0, -0.75], AL: [-1.25, 0, 0.8],
    TR: [-0.55, 0, -0.2], TL: [-0.2, 0, 0.18], SR: 1.1, SL: 0.8, WR: [0.9, 0, 0], WL: [0.4, 0, 0] },
];

/** Recoil pose targets for a HURT / KNOCK soldier into T. Returns the blend rate (1/s), or 0 once the recoil is over
 *  (the caller then blends back to its guard stance). */
function recoilPose(T, i, s, t, sd) {
  const knock = s === ST.KNOCK, hold = knock ? 16 : 12;
  if (t >= hold) return 0;
  const r = hash01(i, 97), v = RECOIL[r < 0.5 ? 0 : r < 0.82 ? 1 : 2];
  const amp = 0.88 + 0.24 * hash01(i, 98), m = sd;               // m = -1 mirrors left ↔ right
  const drift = Math.min(t, 8) * 0.03;                           // the blow keeps carrying the arms back a little
  const put = (k, a, x = 0) => { T[k] = (a[0] - x) * amp; T[k + 1] = a[1] * amp * m; T[k + 2] = a[2] * amp * m; };
  put(TO, v.TO, drift); put(HE, v.HE);
  // limbs: mirrored soldiers swap sides (a roll that pushes the right arm out pushes the left arm out when negated)
  put(m > 0 ? AR : AL, v.AR, drift); put(m > 0 ? AL : AR, v.AL, drift);
  put(m > 0 ? TR : TL, v.TR); put(m > 0 ? TL : TR, v.TL);
  T[m > 0 ? SR : SL] = v.SR; T[m > 0 ? SL : SR] = v.SL;
  T[WR] = v.WR[0]; T[WL] = v.WL[0];
  if (knock) {                                                   // officers: stumbling steps back
    const st = Math.sin(t * 0.5) * 0.35;
    T[TL] += st; T[TR] -= st;
  }
  // snap in on the contact frames (per-soldier speed → the band ripples), then hold
  return t < 2 ? 55 + 45 * hash01(i, 99) : 16;
}

/** Dithered dissolve for fragments closer than `near` metres to the camera (DW-style: nothing blocks the lens). */
function nearFade(material, near, extra) {
  material.customProgramCacheKey = () => `crowd-fade-${near}-${!!extra}`;
  material.onBeforeCompile = (sh) => {
    if (extra) extra(sh);
    sh.vertexShader = 'varying vec3 vCrowdWP;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 cwp = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        cwp = instanceMatrix * cwp;
      #endif
      vCrowdWP = (modelMatrix * cwp).xyz;`);
    sh.fragmentShader = 'varying vec3 vCrowdWP;\n' + sh.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      // camera part (r3): a clean cut at ≈1.3 × near with a thin dithered rim, not a wide screen-door band (under the
      // DoF a wide per-pixel dissolve turned near soldiers and banners into a coarse mosaic)
      float cfade = smoothstep(${(near * 1.27).toFixed(2)}, ${(near * 1.33).toFixed(2)}, distance(vCrowdWP, cameraPosition));
      if (cfade < 1.0 && cfade < fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(0.06711056, 0.00583715))))) discard;`);
  };
}

export function createCrowdView(scene, game) {
  const crowd = game.crowd, N = crowd.N;
  const geos = buildCrowdGeometries();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.06, flatShading: true });
  nearFade(mat, 2.4, (sh) => {
    // backlit golden hour: a little self-light keeps the army from reading as black blocks, and the Wei reds
    // (headbands, crests, sashes) glow enough to read as a pattern at distance
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      #ifdef USE_COLOR
        float cRed = smoothstep(0.3, 0.5, vColor.r - max(vColor.g, vColor.b));
        totalEmissiveRadiance += vColor.rgb * (0.08 + cRed * 0.32);
      #endif`);
  });
  patchHitMaterial(mat);                                     // hit-impact: victim flash/tint (src/combat/hitfx.js)
  const meshes = [];
  const proxyMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }), proxies = [];
  /** shadow: true (the mesh casts), false, or a proxy geometry that casts instead (shares the instance matrices) */
  const mk = (geo, cap, material = mat, shadow = true) => {
    const n = Math.max(1, cap);
    const m = new THREE.InstancedMesh(geo, material, n);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = shadow === true; m.receiveShadow = true; m.frustumCulled = false; m.count = 0;
    // hit-impact: per-instance victim glow
    if (material === mat) m.geometry.setAttribute('aHit', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    scene.add(m); meshes.push(m);
    if (shadow && shadow !== true) {
      const p = new THREE.InstancedMesh(shadow, proxyMat, n);
      p.instanceMatrix = m.instanceMatrix; p.castShadow = true; p.frustumCulled = false; p.count = 0;
      scene.add(p); proxies.push([p, m]);
    }
    return m;
  };
  const G = crowd.grunts, O = CROWD.officers;
  const M = {
    hips: mk(geos.hips, G, mat, false), torso: mk(geos.torso, G, mat, geos.shadow_trunk), head: mk(geos.head, G, mat, false),
    crest: mk(geos.crest, G), arm: mk(geos.arm, G * 2, mat, geos.shadow_arm), thigh: mk(geos.thigh, G * 2, mat, geos.shadow_thigh),
    shin: mk(geos.shin, G * 2, mat, geos.shadow_shin),
    spear: mk(geos.spear, G), sword: mk(geos.sword, G), shield: mk(geos.shield, G), glaive: mk(geos.glaive, G + O), pole: mk(geos.pole, G),
    o_hips: mk(geos.o_hips, O), o_torso: mk(geos.o_torso, O), o_head: mk(geos.o_head, O),
    o_arm: mk(geos.o_arm, O * 2), o_thigh: mk(geos.o_thigh, O * 2), o_shin: mk(geos.o_shin, O * 2),
  };
  const PG = { hips: M.hips, torso: M.torso, head: M.head, arm: M.arm, thigh: M.thigh, shin: M.shin };
  const PO = { hips: M.o_hips, torso: M.o_torso, head: M.o_head, arm: M.o_arm, thigh: M.o_thigh, shin: M.o_shin };
  const uTime = { value: 0 };
  const flagGeo = new THREE.PlaneGeometry(0.9, 1.5, 4, 6).rotateX(Math.PI / 2).translate(0.5, 0, 1.78);
  const flagMat = new THREE.MeshStandardMaterial({ map: flagTexture(), side: THREE.DoubleSide, alphaTest: 0.5, roughness: 0.9 });
  // camera part (r3): flags dissolve only near the lens (was 7 m, which screen-doored every banner around the hero
  // into a chain-mail pattern)
  nearFade(flagMat, 3.2, (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float fph = instanceMatrix[3].x * 1.3 + instanceMatrix[3].z * 0.7;
      float fu = clamp((position.x - 0.05) / 0.9, 0.0, 1.0);
      transformed.y += (sin(uTime * 3.6 + position.x * 3.2 - position.z * 1.4 + fph) * 0.1 + sin(uTime * 6.1 + position.z * 2.3 + fph) * 0.03) * fu;`);
  });
  M.flag = mk(flagGeo, G, flagMat, false);
  const markerMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(0.85, 0.8, 0.75), fog: false });
  nearFade(markerMat, 5);
  M.marker = mk(geos.marker, O, markerMat, false);
  M.glint = mk(geos.glint, 32, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.2, 1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false }), false);
  M.glint.renderOrder = 7;                                   // telegraph reads through the ring
  // the red flare before a real blow: a solid (not additive) pixel star with the white star as its core; kept at
  // ≈ 0.5 so the luminance tone curve (post.js) keeps it red instead of bleaching it to pink
  M.flare = mk(geos.glint, 32, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.48, 0.01, 0.005), depthTest: false, fog: false }), false);
  M.flare.renderOrder = 6;

  // per-soldier render state: blended pose channels, a "seen" flag (snap on first sight), stable look variety
  const cur = new Float32Array(N * NCH), T = new Float32Array(NCH), C = new Float32Array(NCH), seen = new Uint8Array(N);
  const tint = new Float32Array(N), side = new Float32Array(N), size = new Float32Array(N);
  for (let i = 0; i < N; i++) { tint[i] = 0.86 + h01(i) * 0.28; side[i] = h01(i, 1) < 0.5 ? 1 : -1; size[i] = 0.96 + h01(i, 2) * 0.08; }
  let time = 0;

  const set3 = (k, x, y, z) => { T[k] = x; T[k + 1] = y; T[k + 2] = z; };

  /** Stance targets (rest / march / guard) for group g; `w` = weapon pitch (world, 0 = level, -π/2 = up). */
  function stance(i, g, s, v, form) {
    const sd = side[i], ph = crowd.phase[i];
    T.fill(0);
    const moving = v > 0.35;
    const rally = !form && !crowd.token[i] && (s === ST.GUARD || s === ST.ADVANCE) && game.frame < crowd.raiseF[i];
    if (s === ST.GUARD || s === ST.ATTACK || rally) {
      // posture: knees bent, weight low, weapon up, bouncing on the balls of the feet
      const bob = Math.sin(time * 4.2 + i * 1.3) * 0.07, br = Math.sin(time * 2.6 + i) * 0.03;
      set3(TO, 0.16 + br, -0.28 * sd, 0); set3(HE, -0.06, 0.25 * sd, 0);
      set3(TL, -0.42, 0, 0.14); set3(TR, 0.22, 0, -0.14); T[SL] = 0.62 + bob; T[SR] = 0.42 + bob;
      if (moving) { const a = 0.32; T[TL] += -a * Math.sin(ph * 1.6); T[TR] += a * Math.sin(ph * 1.6); T[SL] += 0.25 * Math.max(0, Math.cos(ph * 1.6)); T[SR] += 0.25 * Math.max(0, -Math.cos(ph * 1.6)); }
      if (rally) {
        // war cry with the striker next to him (crowd.raiseF): chest out, head thrown back, weapon brandished high and
        // pumped at the hero, free arm up — the ring surges on the beat
        const pump = Math.sin(time * 11 + i * 0.7) * 0.22;
        set3(TO, -0.14, -0.12 * sd, 0); set3(HE, -0.36, 0.1 * sd, 0);
        if (g === 1) { set3(AR, -2.75 + pump, 0, -0.25); T[WR] = -3.7 - T[AR]; set3(AL, -1.5, 0, 0.3); T[WL] = 1.2; }
        else if (g === 3) { set3(AR, -0.9, 0, -0.1); T[WR] = -1.57 - T[AR] + pump; set3(AL, -2.6, 0, 0.3); }
        else { set3(AR, -2.5 + pump, 0, -0.3); T[WR] = -1.15 - T[AR]; set3(AL, -2.4 - pump, 0, 0.35); }
        return;
      }
      // idle feint: now and then a lone guard raises his weapon and shouts
      const feint = !crowd.token[i] && s === ST.GUARD && ((game.frame + i * 53) % 720) < 30;
      if (g === 1) {
        set3(AR, feint ? -2.6 : -0.95, 0, -0.3); T[WR] = (feint ? -3.3 : -0.85) - T[AR];
        set3(AL, -1.15, 0, 0.22); T[WL] = 1.1;
        set3(TO, 0.16 + br, 0.22 * sd, 0);
      } else if (g === 3) {
        set3(AR, -0.62, 0, -0.08); T[WR] = -1.57 - T[AR] + (feint ? 0.25 * Math.sin(time * 9) : 0);
        set3(AL, -0.8, 0, -0.35);
        set3(TO, 0.06, 0, 0);
      } else {
        set3(AR, feint ? -1.3 : -0.42, 0, -0.26); T[WR] = (feint ? -1.5 : -0.5) - T[AR];
        set3(AL, -1.12, 0.1, -0.3); T[WL] = 0;
      }
      if (feint) T[HE] = -0.25;
      return;
    }
    // rest / march / run
    const lean = Math.min(0.26, 0.03 + v * 0.045);
    set3(TO, lean + Math.sin(time * 1.7 + i) * 0.015, 0, 0); set3(HE, -lean * 0.5, 0, 0);
    set3(TL, 0, 0, 0.04); set3(TR, 0, 0, -0.04); T[SL] = T[SR] = 0.04;
    if (moving) {
      const a = Math.min(0.8, 0.28 + v * 0.1), kb = 0.35 + v * 0.13;
      T[TL] = -a * Math.sin(ph); T[TR] = a * Math.sin(ph);
      T[SL] = 0.12 + kb * Math.max(0, Math.cos(ph)); T[SR] = 0.12 + kb * Math.max(0, -Math.cos(ph));
      T[TO + 1] = 0.12 * Math.sin(ph);
    }
    const swing = moving ? Math.min(0.7, 0.2 + v * 0.1) * Math.sin(ph) : 0;
    if (g === 1) {
      const run = moving && !form;
      set3(AR, run ? -1.0 + swing * 0.3 : -0.15 + swing * 0.5, 0, -0.14); T[WR] = (run ? -1.6 : 0.9) - T[AR];
      set3(AL, run ? -0.85 : -0.35 - swing * 0.5, 0, 0.16); T[WL] = -T[AL];
    } else if (g === 3) {
      set3(AR, -0.6, 0, -0.06); T[WR] = -1.57 - T[AR] + swing * 0.08;
      set3(AL, -0.78, 0, -0.36);
    } else if (moving && !form) {                                                    // charging: weapon forward
      set3(AR, -0.42, 0, -0.22); T[WR] = -0.55 - T[AR];
      set3(AL, -1.0 + swing * 0.15, 0.1, -0.3);
    } else {                                                                          // upright, shouldered
      set3(AR, -0.32, 0, -0.1); T[WR] = -1.5 - T[AR];
      set3(AL, swing * 0.8 + 0.02, 0, 0.1);
    }
  }

  /** Full pose targets for soldier i; returns the blend rate (1/s). */
  function pose(i, s, t) {
    const g = GROUP[crowd.kind[i]], sd = side[i];
    const v = Math.hypot(crowd.vx[i], crowd.vz[i]);
    if (s <= ST.ATTACK) {
      stance(i, g, s, v, crowd.form[i]);
      if (s !== ST.ATTACK) return 12;
      const w = CROWD.windup;
      if (t < w - 3) {                                                                // wind-up: coil and hold (telegraph)
        // big overhead coil read at gameplay distance: weapon high over the head, body arched back on a wide stance;
        // the last 14 sf he trembles at full stretch
        const hot = t >= w - 14, tr = (hot ? Math.sin(t * 2.3) * 0.09 : Math.sin(t * 1.9) * 0.04) * smoothstep(t, 0, 12);
        if (g === 0) { set3(TO, -0.22, -0.45, 0); set3(HE, -0.2, 0.4, 0); set3(AR, -2.75, 0, -0.35); T[WR] = -0.2 - T[AR] + tr; set3(AL, -1.9, 0.2, 0.2); }
        else if (g === 1) { set3(TO, -0.24, 0.3, 0); set3(AR, -3.0, 0, -0.2); T[WR] = -4.0 - T[AR] + tr; set3(AL, -1.35, 0, 0.3); T[WL] = 1.2; }
        else { set3(TO, -0.24, -0.55, 0); set3(HE, -0.1, 0.45, 0); set3(AR, -2.7, 0, -0.5); T[WR] = -3.4 - T[AR] + tr; set3(AL, -2.4, 0, 0.45); }
        set3(TL, -0.62, 0, 0.18); set3(TR, 0.45, 0, -0.18); T[SL] = 0.75; T[SR] = 0.5;
        return 9;
      }
      if (t < w + 10) {                                                               // strike + lunge
        if (g === 0) { set3(TO, 0.36, 0.35, 0); set3(AR, -1.4, 0, -0.08); T[WR] = -0.04 - T[AR]; set3(AL, -1.45, 0, -0.2); }
        else if (g === 1) { set3(TO, 0.42, -0.12, 0); set3(AR, -0.62, 0, -0.1); T[WR] = 0.62 - T[AR]; set3(AL, -0.8, 0, 0.3); T[WL] = 0.8; }
        else { set3(TO, 0.36, 0.55, 0); set3(AR, -0.9, 0, 0.25); T[WR] = 0.35 - T[AR]; set3(AL, -0.8, 0, -0.3); }
        set3(TL, -0.85, 0, 0.12); set3(TR, 0.55, 0, -0.12); T[SL] = 0.9; T[SR] = 0.12;
        return 42;
      }
      return 7;                                                                      // recovery: ease back to guard
    }
    T.fill(0);
    if (s === ST.HURT || s === ST.KNOCK) {
      // hit-impact: DW flinch — arms flung up and back, stumble, then back to guard (recoilPose)
      const rate = recoilPose(T, i, s, t, sd);
      if (rate) return rate;
      stance(i, g, ST.GUARD, 0, 0); return 8;
    }
    if (s === ST.AIR) {
      set3(TO, -0.3 + Math.sin(t * 0.3) * 0.2, 0, Math.sin(t * 0.23) * 0.2); set3(HE, -0.6, 0, 0);
      set3(AR, -2.4 + Math.sin(t * 0.5) * 0.5, 0, -0.9); set3(AL, -2.2 + Math.cos(t * 0.5) * 0.5, 0, 0.9); T[WR] = 0.8; T[WL] = 0.6;
      set3(TL, -0.85, 0, 0.25); set3(TR, -0.2, 0, -0.3); T[SL] = 1.2; T[SR] = 0.5;
      return 16;
    }
    if (s === ST.GETUP) {
      const u = smoothstep(t, 0, 26);
      if (u > 0.55) { stance(i, g, ST.GUARD, 0, 0); return 10; }
      set3(TO, 0.5, 0, 0); set3(AR, -0.5, 0, -0.45); set3(AL, -0.5, 0, 0.45); T[WR] = 0.3;
      set3(TL, -1.3, 0, 0.2); set3(TR, -1.1, 0, -0.2); T[SL] = 1.6; T[SR] = 1.5;
      return 12;
    }
    // DOWN / DEAD: sprawled, one knee up
    set3(HE, -0.25, 0.4 * sd, 0); set3(AR, -0.25, 0, -1.4); set3(AL, -0.45, 0, 1.2); T[WR] = 0.9; T[WL] = 0.5;
    set3(TL, -0.1, 0, 0.3); set3(TR, -0.55, 0, -0.18); T[SL] = 0.1; T[SR] = 0.85;
    if (s === ST.DOWN) T[TO] = Math.sin(time * 5 + i) * 0.03;
    return 14;
  }

  const _root = new THREE.Matrix4(), _tmp = new THREE.Matrix4(), _loc = new THREE.Matrix4(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
  const mHips = new THREE.Matrix4(), mTorso = new THREE.Matrix4(), mArmR = new THREE.Matrix4(), mArmL = new THREE.Matrix4();
  const mThigh = new THREE.Matrix4(), mOut = new THREE.Matrix4(), mW = new THREE.Matrix4();
  const _c = new THREE.Color(), _ch = new THREE.Color(), _v = new THREE.Vector3(), _s = new THREE.Matrix4();
  const _glintCold = new THREE.Color(0.55, 0.55, 0.55);    // × glint material: the white wind-up star
  const _g = [0, 0, 0];                                      // hit-impact: emissive glow of the soldier being written
  const local = (out, parent, px, py, pz, rx, ry, rz) => {
    _loc.makeRotationFromEuler(_e.set(rx, ry, rz)).setPosition(px, py, pz);
    return out.multiplyMatrices(parent, _loc);
  };
  // Instances are packed per frame; every write is also recorded per soldier so a standing soldier can be replayed
  // (copied) on most frames instead of recomputed.
  const REC = 16, recMesh = new Array(N * REC), recMat = new Float32Array(N * REC * 16), recCol = new Float32Array(N * REC * 3), recN = new Uint8Array(N);
  let recI = 0;
  const push = (m, mat, col) => {
    const n = m.count++, r = recI * REC + recN[recI]++;
    mat.toArray(m.instanceMatrix.array, n * 16); mat.toArray(recMat, r * 16); recMesh[r] = m;
    if (col) { col.toArray(m.instanceColor.array, n * 3); col.toArray(recCol, r * 3); }
    else { m.instanceColor.array.fill(1, n * 3, n * 3 + 3); recCol.fill(1, r * 3, r * 3 + 3); }
    const h = m.geometry.attributes.aHit;                    // hit-impact: glow of the soldier being written
    if (h) h.array.set(_g, n * 3);
  };
  const replay = (i) => {
    for (let k = 0; k < recN[i]; k++) {
      const r = i * REC + k, m = recMesh[r], n = m.count++;
      m.instanceMatrix.array.set(recMat.subarray(r * 16, r * 16 + 16), n * 16);
      m.instanceColor.array.set(recCol.subarray(r * 3, r * 3 + 3), n * 3);
      const h = m.geometry.attributes.aHit;                  // replayed soldiers are never flashing
      if (h) h.array.fill(0, n * 3, n * 3 + 3);
    }
  };
  let frameNo = 0;

  function write(i, s, dt) {
    const t = crowd.stT[i], o = i * NCH, officer = crowd.type[i] === 1, kind = crowd.kind[i], g = GROUP[kind];
    const rate = pose(i, s, t);
    const k = seen[i] ? 1 - Math.exp(-rate * dt) : 1;
    seen[i] = 1; recI = i; recN[i] = 0;
    for (let j = 0; j < NCH; j++) { cur[o + j] += (T[j] - cur[o + j]) * k; C[j] = cur[o + j]; }
    // pelvis height from the legs (bent knees lower the body; lying overrides)
    const pel = -J.hipY + Math.max(legH(C[TL], C[SL], C[TL + 2]), legH(C[TR], C[SR], C[TR + 2]));
    const sc = (officer ? 1.16 : kind === KIND.CAPTAIN ? 1.06 : 1) * size[i];
    const rx = crowd.rx[i];
    let y = crowd.y[i] + pel * sc;
    if (s >= ST.AIR && s <= ST.DEAD) {
      // hit-impact: lower the pivot by how horizontal the body is (on its back or face down, in the air too), so a
      // tumbling body touches the ground continuously instead of snapping down when it lands
      const lie = Math.abs(Math.sin(rx));
      y = crowd.y[i] + (pel * sc) * (1 - lie) + 0.14 * lie;
      if (s === ST.DEAD && t > CROWD.deadTime - 50) y -= (t - (CROWD.deadTime - 50)) / 50 * 0.5;
    }
    const shake = crowd.hs[i] > 0 ? Math.sin(crowd.hs[i] * 2.7) * 0.05 : 0;
    _root.makeRotationFromEuler(_e.set(rx, crowd.yaw[i], 0)).setPosition(crowd.x[i] + shake, y, crowd.z[i]);
    _root.multiply(_s.makeScale(sc, sc, sc));
    // colour: per-soldier tint; the hit flash is an emissive glow (hit-impact, src/combat/hitfx.js)
    const f = tint[i], cap = kind === KIND.CAPTAIN;
    _ch.setRGB(f, f * 0.98, f * 0.95);
    hitGlow(crowd, i, _g);
    // telegraph: the last 14 sf of a blow that will really come (feints don't flare)
    const hotStrike = s === ST.ATTACK && !crowd.feint[i] && t >= CROWD.windup - 14 && t < CROWD.windup;
    if (cap) _c.setRGB(_ch.r * 1.45, _ch.g * 1.1, _ch.b * 0.7); else _c.copy(_ch);                  // captains: bronze armour
    const P = officer ? PO : PG;
    push(P.hips, mHips.copy(_root), _c);
    local(mTorso, mHips, 0, J.waist, 0, C[TO], C[TO + 1], C[TO + 2]); push(P.torso, mTorso, _c);
    push(P.head, local(mOut, mTorso, 0, J.neck, 0, C[HE], C[HE + 1], C[HE + 2]), _ch);
    if (cap) push(M.crest, mOut, _ch);
    local(mArmR, mTorso, -J.shX, J.shY, 0, C[AR], C[AR + 1], C[AR + 2]); push(P.arm, mArmR, _c);
    local(mArmL, mTorso, J.shX, J.shY, 0, C[AL], C[AL + 1], C[AL + 2]); push(P.arm, mArmL, _c);
    local(mThigh, mHips, -J.hipX, J.hipY, 0, C[TR], C[TR + 1], C[TR + 2]); push(P.thigh, mThigh, _c);
    push(P.shin, local(mOut, mThigh, 0, -J.knee, 0, C[SR], 0, 0), _c);
    local(mThigh, mHips, J.hipX, J.hipY, 0, C[TL], C[TL + 1], C[TL + 2]); push(P.thigh, mThigh, _c);
    push(P.shin, local(mOut, mThigh, 0, -J.knee, 0, C[SL], 0, 0), _c);
    // weapons
    _g[0] = _g[1] = _g[2] = 0;                               // hit-impact: the victim tint is body-only (DW keeps weapons neutral)
    local(mW, mArmR, 0, -J.hand, 0, C[WR], C[WR + 1], C[WR + 2]);
    const wm = g === 0 ? M.spear : g === 1 ? M.sword : g === 2 ? M.glaive : M.pole;
    push(wm, mW, _c);
    if (g === 3) push(M.flag, mW, null);
    if (g === 1) push(M.shield, local(mOut, mArmL, 0, -J.hand, 0, C[WL], C[WL + 1], C[WL + 2]), _c);
    // telegraph: pixel-star glint on the weapon tip through the wind-up (drawn over the crowd); a real blow flares it
    // into a big solid red pixel star (white core) for the last 14 sf
    if (s === ST.ATTACK && t >= 3 && t < CROWD.windup && M.glint.count < 32) {
      const pulse = hotStrike ? 0.46 + 0.16 * Math.abs(Math.sin(t * 0.9)) : 0.2 + 0.12 * Math.abs(Math.sin(t * 0.33)) + (t < 10 ? (10 - t) * 0.025 : 0);
      _tmp.makeRotationFromEuler(_e.set(t * 0.07, t * 0.11, 0.6)).scale(_v.set(pulse, pulse, pulse));
      _tmp.setPosition(_v.set(0, 0, TIP[g]).applyMatrix4(mW));
      if (hotStrike) { push(M.flare, _tmp, null); _tmp.scale(_v.set(0.45, 0.45, 0.45)); }
      push(M.glint, _tmp, _glintCold);
    }
    // hud part (r4): inside HUD_TAG_R the HUD's ▼▼ name/HP tag marks the officer; skip the 3D ▼
    if (officer && s !== ST.DEAD && !((crowd.x[i] - game.hero.x) ** 2 + (crowd.z[i] - game.hero.z) ** 2 < HUD_TAG_R ** 2)) {
      _tmp.makeRotationY(time * 2.2).scale(_v.set(0.7, 0.7, 0.7)).setPosition(crowd.x[i], y + 1.35 * sc + 0.62 + Math.sin(time * 3 + i) * 0.06, crowd.z[i]);
      push(M.marker, _tmp, null);
    }
  }

  return {
    update(dt) {
      time += dt; uTime.value = time; frameNo++;
      for (const m of meshes) m.count = 0;
      for (let i = 0; i < N; i++) {
        const s = crowd.st[i];
        if (s === ST.OFF) { seen[i] = 0; continue; }
        // standing soldiers (idle ranks) are recomputed every 4th frame and replayed in between
        if (s === ST.IDLE && seen[i] && crowd.type[i] === 0 && !crowd.flash[i] && ((frameNo + i) & 3)) replay(i);
        else write(i, s, (s === ST.IDLE ? 4 : 1) * dt);
      }
      for (const m of meshes) {
        m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true;
        if (m.geometry.attributes.aHit) m.geometry.attributes.aHit.needsUpdate = true;
        m.visible = m.count > 0;                                                          // no empty draw calls
      }
      for (const [p, m] of proxies) { p.count = m.count; p.visible = m.visible; }
    },
  };
}
