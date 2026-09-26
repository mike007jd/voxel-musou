// Hero glue. Sim side: owns Zhao Yun's state and runs combo/locomotion/physics each fixed step, plus animation
// bookkeeping (which clip, normalised time, blend-from) so the rendered pose is a pure function of sim state.
// Render side: createHeroView builds rig + voxel model + secondary chains and poses them from the sim state.
import * as THREE from 'three';
import { ATTACK_CLIPS, MOVE_FEET } from './anims/attacks.js';
import { LOCO_CLIPS, runPose, rollPose, applyRoll, createDodgeGhosts } from './anims/locomotion.js';
import { createRig, sampleClip, blendStep, turnPose, POSE_SIZE, HERO_SCALE } from './rig.js';
import { createHeroModel } from './model.js';
import { createSecondary } from './secondary.js';
import { MOVES, moveClip } from './moves.js';
import { bufferInput, stepCombo } from './combo.js';
import { stepLocomotion, stepPhysics, setState, LOCO } from './locomotion.js';
import { ARENA_RADIUS, WALL_Z } from '../world/world.js';
import { emit } from '../core/events.js';

/** Clip registry sampled by the hero. Other parts (musou) register their clips here. */
export const CLIPS = { ...ATTACK_CLIPS, ...LOCO_CLIPS };

export function createHero(game) {
  const h = { hpMax: 400, musouMax: 100, dodgeX: 0, dodgeZ: 1, anim: { from: new Float32Array(POSE_SIZE) } };

  h.reset = ({ x = 0, z = 0, yaw = 0 } = {}) => {
    Object.assign(h, { x, y: 0, z, vx: 0, vy: 0, vz: 0, yaw, hp: h.hpMax, musou: 0, state: 'idle', stateT: 0, move: null,
      moveT: 0, moveSeq: 0, grounded: true, airAttack: false, iframes: 0, speed: 0, runT: 0, runPhase: 0, combo: 0, comboT: 0,
      kos: 0, buf: null, bufT: 0, dodgeBuf: 0, jumpBuf: 0, musouBuf: 0, musouClip: null, musouT: 0,
      airN: 0, moveAir: false, dodgeSeq: 0 });                // combo-system: air-string count, vault
    Object.assign(h.anim, { id: 'idle', t: 0, k: 0, seq: -1, blendF: 1, blendN: 1, yaw,
      lean: 0,                        // run bank (locomotion)
      fx: x, fz: z, px: x, pz: z,     // spear-anim: root at the transition / last step (feet stay planted through a blend)
      mf: null, mt: 0 });             // spear-anim: move whose baked feet apply (MOVE_FEET) and its move time, as shown
  };
  h.reset();

  /** Called by combat when an enemy strike connects. Any attack move armours against grunts; officers need `armor`. */
  h.hurt = (dmg, fromX, fromZ, officer) => {
    if (h.iframes > 0 || h.state === 'musou' || h.state === 'dodge') return false;
    h.hp = Math.max(1, h.hp - dmg);            // v0: the hero cannot die (demo keeps running)
    h.musou = Math.min(h.musouMax, h.musou + dmg * 0.15);
    const armored = !!h.move && (!officer || MOVES[h.move].armor);
    emit('hero:hurt', { dmg, hp: h.hp, x: h.x, y: h.y + 1.2, z: h.z, armored });
    if (armored) return true;
    const dx = h.x - fromX, dz = h.z - fromZ, l = Math.hypot(dx, dz) || 1;
    h.move = null; setState(h, 'hurt');
    h.vx = dx / l * 3.5; h.vz = dz / l * 3.5;
    h.iframes = 40;
    h.combo = 0; h.comboT = 0;
    return true;
  };

  h.step = (inp) => {
    bufferInput(h, inp);
    if (inp.pressed.musou) h.musouBuf = 8;
    if (game.hitstop > 0) { game.hitstop--; return; }        // frozen by hitstop; presses stay buffered
    h.stateT++;
    if (h.iframes > 0) h.iframes--;
    if (h.comboT > 0 && --h.comboT === 0) h.combo = 0;
    if (h.musouBuf > 0) h.musouBuf--;
    if (h.state === 'musou') game.musou.stepHero(inp);
    // musou part r3: one full gauge segment is enough (game.musou.ready; one Musou spends one of the 3 segments)
    else if (h.musouBuf && game.musou.ready() && h.grounded && h.state !== 'hurt') { h.musouBuf = 0; game.musou.start(inp); }
    else if (!stepCombo(h, inp, game)) stepLocomotion(h, inp, game.cam.yaw);
    if (stepPhysics(h) && h.state === 'jump') setState(h, 'land');
    // arena bounds (castle wall in +Z)
    const r = Math.hypot(h.x, h.z);
    if (r > ARENA_RADIUS) { h.x *= ARENA_RADIUS / r; h.z *= ARENA_RADIUS / r; }
    if (h.z > WALL_Z - 3) h.z = WALL_Z - 3;
    updateAnim(h);
  };
  return h;
}

// ---------------------------------------------------------------- animation bookkeeping (sim, deterministic)
function animDesc(h) {
  switch (h.state) {
    // combo-system seam: moves.js `anim` retimes the clip (holds, snaps, clip cuts); a cut counts as a new anim seq → blend
    case 'attack': { const c = moveClip(MOVES[h.move], h.moveT); return [c[0], c[1], 0, h.moveSeq * 16 + c[2]]; }
    case 'musou': return [h.musouClip, h.musouT, 0, -2];
    case 'run': return ['run', h.runPhase, Math.min(1, h.speed / LOCO.runSpeed), -1];
    case 'dodge': return ['dodge', h.stateT / LOCO.dodgeFrames, 0, -100 - h.dodgeSeq];   // new seq per dodge → re-blend on a double dodge
    // locomotion-dodge r2: after an air string (airN > 0) the fall uses the DW8 spread-arm descent
    case 'jump': return [h.airN ? 'airFall' : 'air', Math.min(1, Math.max(0, 0.5 - h.vy / (2 * LOCO.jumpV))), 0, -1];
    case 'land': return ['land', h.stateT / LOCO.landFrames, 0, -1];
    case 'hurt': return ['hurt', h.stateT / LOCO.hurtFrames, 0, -1];
    default: return ['idle', (h.stateT % 150) / 150, 0, -1];
  }
}
// spear-anim: a transition blends from the pose that was actually shown last frame (a.from — includes any blend still
// running, so chained moves never pop), re-expressed in the new facing: a yaw snap at move start (soft-lock / stick
// steering) becomes a short turn through the spin channel instead of a one-frame body rotation.
const _F = new Float32Array(POSE_SIZE);
function updateAnim(h) {
  const a = h.anim;
  const [id, t, k, seq] = animDesc(h);
  if (id !== a.id || seq !== a.seq) {
    heroPose(h, _F); a.from.set(_F); turnPose(a.from, a.yaw - h.yaw);   // spear-anim: feet keep their ground spots
    a.fx = a.px; a.fz = a.pz;
    a.blendN = ATTACK_CLIPS[id] ? 5 : id === 'dodge' ? 3 : id === 'run' ? 6 : 8;
    a.blendF = 1; a.id = id; a.seq = seq;          // spear-anim: the first frame of a move already moves off the old pose
  } else if (a.blendF < a.blendN) a.blendF++;
  a.t = t; a.k = k; a.yaw = h.yaw; a.px = h.x; a.pz = h.z;
  a.mf = h.state === 'attack' && MOVE_FEET[h.move] ? h.move : null; a.mt = h.moveT;
}

// ---------------------------------------------------------------- pose (pure)
/** Current pose of the hero (pure function of sim state). */
export function heroPose(h, out) {
  const a = h.anim;
  if (a.id === 'run') runPose(a.t, a.k, out, a.lean);
  else if (a.id === 'dodge') rollPose(a.t, out);            // procedural dive roll (anims/locomotion.js)
  else sampleClip(CLIPS[a.id] || CLIPS.idle, a.t, out);
  // spear-anim: a move that borrows another move's clip (moves.js `anim`) gets feet baked for its own root motion
  if (a.mf) MOVE_FEET[a.mf](a.mt / MOVES[a.mf].frames, out);
  if (a.blendF < a.blendN) {
    const u = a.blendF / a.blendN;
    // spear-anim: feet step from where they stood (root travel since the transition undone in the hero frame; a teleport → 0)
    let dx = h.x - a.fx, dz = h.z - a.fz;
    if (dx * dx + dz * dz > 9) dx = dz = 0;
    const c = Math.cos(h.yaw), s = Math.sin(h.yaw);
    blendStep(a.from, out, u * u * (3 - 2 * u), out, dx * c - dz * s, dx * s + dz * c);
  }
  return out;
}

// ---------------------------------------------------------------- view
export function createHeroView(scene, hero) {
  const rig = createRig();
  scene.add(rig.root);
  const model = createHeroModel(rig);
  const secondary = createSecondary(scene, rig, model.material);
  const ghosts = createDodgeGhosts(scene, model);   // dodge afterimages + i-frame flash (locomotion-dodge)
  const pose = new Float32Array(POSE_SIZE);
  const pos = new THREE.Vector3();
  return {
    update(dt) {
      heroPose(hero, pose);
      rig.root.scale.set(1, 1, 1);               // locomotion-dodge r3: applyRoll's squash & stretch is per frame; IK needs scale 1
      rig.apply(pose, pos.set(hero.x, hero.y, hero.z), hero.yaw);
      rig.root.scale.setScalar(HERO_SCALE); rig.root.updateMatrixWorld(true);   // after IK: grow the posed body about the ground point
      applyRoll(rig, hero.anim);                 // dive roll: whole-body pitch about the tucked ball (locomotion-dodge)
      ghosts.update(hero, rig, dt);
      secondary.update(dt);
    },
    reset() { secondary.reset(); },
  };
}
