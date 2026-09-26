// Combo state machine: input buffer, move start/advance, cancel windows, lunge, steering, air moves.
import { MOVES, NEUTRAL, AIR_CHAIN_MAX, lungeAt } from './moves.js';
import { stickDir, turnToward, startDodge, startJump, setState, LOCO } from './locomotion.js';
import { ST, CROWD } from '../crowd/crowd.js';
import { emit } from '../core/events.js';

const BUF = 14;           // frames a press stays buffered once it is eligible to fire
const WAIT = 40;          // frames a press may wait for its window before it is dropped: covers every normal's cancel
                          // (N6: 38), so a mashed tap always lands on the beat, while a tap made at the start of a 2 s
                          // charge does not fire 1.8 s later
const ABSORB = 8;         // hitstop frames a light move's beat absorbs (two windows at COMBAT.stopMax)

/** Record presses. A press made during a move or dodge waits for the point where it may cancel it (mash-friendly). */
export function bufferInput(h, inp) {
  // A charge finisher (C1–C6) is a commitment: □/△ pressed before its last BUF frames to the cancel are dropped (DW8),
  // so X X Y typed into the hold doesn't come out as a stale C1 after it; presses in the recovery start the next string.
  const m = h.move && MOVES[h.move];
  if (m && h.move[0] === 'c' && h.moveT < m.cancel - BUF) return bufferOther(h, inp);
  if (inp.pressed.attack) { h.buf = 'attack'; h.bufT = 0; h.bufW = 0; }
  else if (inp.pressed.charge) { h.buf = 'charge'; h.bufT = 0; h.bufW = 0; }
  bufferOther(h, inp);
}
function bufferOther(h, inp) {
  if (inp.pressed.dodge) { h.dodgeBuf = 8; h.dodgeW = 0; h.buf = null; }   // the latest intent wins: a dodge drops a pending attack
  if (inp.pressed.jump) { h.jumpBuf = 8; h.jumpW = 0; }
}

/** The string's beat: a light ground move may be cancelled `cancel` sim frames after it started, hitstop included (up
 *  to ABSORB), so a mashed string keeps the same spacing on an empty field and in a packed ring. Heavy / armoured moves
 *  and air moves keep their full length after hitstop (the weight of a finisher). */
function beatOk(h, m, game) {
  const stop = m.armor || m.air ? 0 : Math.min(ABSORB, game.frame - h.moveF0 - h.moveT);
  return h.moveT + stop >= m.cancel;
}

/** May the buffered press start the next move? △ branches off N1–N5 as soon as the strike is over (`branch`, cutting
 *  the follow-through as DW8XL does); □ waits for the beat. */
const bufOk = (h, m, game) => (h.buf === 'charge' && m.branch ? h.moveT >= m.branch : beatOk(h, m, game));

/** A dodge cancels any move during its wind-up (before the first active frame) or from `dodgeCancel` on; a light ground
 *  move (N1–N5, dash) also between its strikes, so evasion waits at most for the strike in progress. Armoured moves (N6,
 *  charges) are a commitment: after the wind-up they only let go once they have delivered. */
const dodgeOk = (h, m) => h.moveT < m.tell || h.moveT >= m.dodgeCancel
  || (!m.armor && !m.air && !m.hits.some(({ f }) => h.moveT >= f[0] && h.moveT <= f[1]));

// Presses age slowly (BUF) once they could fire, so a press made early in a move lands exactly on its cancel frame (the
// beat), a jump pressed during a dodge comes out when the dodge may be cancelled, and a press made while staggered comes
// out as soon as the hero recovers. Before that a press waits at most WAIT frames.
function ageBuffer(h, game) {
  const m = h.move && MOVES[h.move];
  if (h.state === 'hurt') return;
  const dodging = h.state === 'dodge';
  const atkOk = m ? beatOk(h, m, game) : !dodging || h.stateT >= LOCO.dodgeAttackCancel;
  if (h.buf && ((m ? bufOk(h, m, game) : atkOk) ? ++h.bufT > BUF : ++h.bufW > WAIT)) h.buf = null;
  if (h.dodgeBuf > 0) {
    if (m ? dodgeOk(h, m) : !dodging || h.stateT >= LOCO.dodgeRedodge) h.dodgeBuf--;
    else if (++h.dodgeW > WAIT) h.dodgeBuf = 0;
  }
  if (h.jumpBuf > 0) { if (atkOk) h.jumpBuf--; else if (++h.jumpW > WAIT) h.jumpBuf = 0; }
}

function startMove(h, id, inp, game) {
  const m = MOVES[id];
  h.move = id; h.moveT = 0; h.moveSeq++; h.moveF0 = game.frame;
  h.moveAir = !h.grounded;
  setState(h, 'attack');
  h.buf = null;
  if (!m.air) { h.vx = 0; h.vz = 0; }
  else {
    h.vx *= 0.4; h.vz *= 0.4; h.vy = Math.max(h.vy, m.hover);
    h.airAttack = true; h.airN++;
  }
  // steering: stick wins; otherwise soft-lock (threat first, then the nearest enemy roughly in front)
  const [dx, dz, mag] = stickDir(inp, game.cam.yaw);
  if (mag) h.yaw = Math.atan2(dx, dz);
  else {
    const t = softTarget(h, m, game.crowd);
    if (t >= 0) h.yaw = Math.atan2(game.crowd.x[t] - h.x, game.crowd.z[t] - h.z);
  }
  emit('attack:start', { move: id, x: h.x, y: h.y, z: h.z, yaw: h.yaw, charge: id[0] === 'c' || id === 'jc', tell: m.tell });
}

/** Is a point at (forward lz, left lx) from the hero inside `hit`'s footprint, with a little margin? */
function covers(hit, lz, lx) {
  if (hit.shape === 'circle') return true;
  if (hit.shape === 'line') return lz > 0 && Math.abs(lx) < hit.width / 2;
  let a = Math.atan2(lx, lz) * 180 / Math.PI - (hit.dir || 0);
  a = ((a + 540) % 360) - 180;
  return Math.abs(a) < hit.ang / 2 - 15;
}

/** Soft-lock: an enemy winding up a strike within reach that this move can still beat to the punch (the most urgent
 *  one) if the move's first hitbox would miss it; if every such threat is already covered, keep the facing; otherwise
 *  the nearest enemy roughly in front. Facing the threat is what keeps a string from being interrupted in a crowd.
 *  Coverage is judged from where the lunge will have carried the hero by the first active frame (a step-in swing can
 *  leave a flank attacker behind the arc). */
function softTarget(h, m, c) {
  const hit = m.hits[0], sn = Math.sin(h.yaw), cs = Math.cos(h.yaw);
  const fwd = lungeAt(m, m.tell);
  let best = -1, bt = -1, covered = false;
  for (let i = 0; i < c.N; i++) {
    const t = c.stT[i];
    if (c.st[i] !== ST.ATTACK || t + m.tell >= CROWD.strike) continue;
    const dx = c.x[i] - h.x, dz = c.z[i] - h.z;
    if (dx * dx + dz * dz > 3.2 * 3.2) continue;
    if (hit && covers(hit, dx * sn + dz * cs - fwd, dx * cs - dz * sn)) { covered = true; continue; }
    if (t > bt) { bt = t; best = i; }
  }
  if (best >= 0 || covered) return best;
  return c.nearest(h.x, h.z, 5.5, h.yaw, 1.9);
}

// Back in stance = the string is over (as in DW8): a □ after the recovery starts N1 again. A late press still continues
// the string throughout the follow-through (cancel → frames, 10–18 sf after the beat).
function endMove(h) {
  h.move = null;
  setState(h, h.grounded ? 'idle' : 'jump');
}

/** Advance moveT, with the vertical script (leap / hang / plunge) and touchdown handling for landFrame moves. */
function advance(h, m) {
  const t = h.moveT;
  if (m.leap && t === m.leap[0]) { h.vy = m.leap[1]; h.grounded = false; }
  if (!h.grounded) h.moveAir = true;
  if (m.hang && t === m.hang[0] && h.vy > 0 && !h.grounded) return;    // the jump finishes its own rise, tell held
  if (m.hang && t >= m.hang[0] && t < m.hang[1] && !h.grounded) h.vy = 0;
  if (m.plunge && t === m.plunge[0] && !h.grounded) h.vy = m.plunge[1];
  if (!m.landFrame) { h.moveT++; return; }
  if (h.moveAir && h.grounded && t < m.landFrame) h.moveT = m.landFrame;          // touchdown → impact frame
  else { h.moveT++; if (!h.grounded && h.moveT >= m.landFrame) h.moveT = m.landFrame - 1; }
}

/**
 * Returns true while the hero is busy with a move (locomotion must not run this frame).
 * Called once per sim frame when not in hitstop.
 */
export function stepCombo(h, inp, game) {
  ageBuffer(h, game);
  if (h.grounded && !h.move) h.airN = 0;
  const m = h.move && MOVES[h.move];
  if (m) {
    // steer early frames
    if (h.moveT < m.steer) {
      const [dx, dz, mag] = stickDir(inp, game.cam.yaw);
      if (mag) turnToward(h, Math.atan2(dx, dz), 0.35);
    }
    // lunge
    const d = lungeAt(m, h.moveT + 1) - lungeAt(m, h.moveT);
    h.x += Math.sin(h.yaw) * d; h.z += Math.cos(h.yaw) * d;
    advance(h, m);
    // cancels (air strings chain only while airborne and up to AIR_CHAIN_MAX swipes)
    if (h.buf && bufOk(h, m, game) && (m.air ? !h.grounded && h.airN < AIR_CHAIN_MAX : h.grounded)) {
      const next = h.buf === 'attack' ? m.next : m.charge;
      if (next) { startMove(h, next, inp, game); return true; }
    }
    if (h.dodgeBuf && dodgeOk(h, m) && h.grounded) { h.dodgeBuf = 0; startDodge(h, inp, game.cam.yaw); return true; }
    if (h.jumpBuf && beatOk(h, m, game) && h.grounded && !m.air) { h.jumpBuf = 0; h.move = null; startJump(h); return false; }
    if (m.air && h.grounded && !m.landFrame) { h.move = null; setState(h, 'land'); return false; }
    if (h.moveT >= m.frames) {
      endMove(h);
      return neutral(h, inp, game);
    }
    return true;
  }
  return neutral(h, inp, game);
}

/** Free state: start attacks, dodges and jumps when allowed. */
function neutral(h, inp, game) {
  const s = h.state;
  if (s === 'hurt') return false;
  const dodgeOk = h.grounded && (s !== 'dodge' || h.stateT >= LOCO.dodgeRedodge);
  if (h.dodgeBuf && dodgeOk && s !== 'land') { h.dodgeBuf = 0; startDodge(h, inp, game.cam.yaw); return false; }
  const cancelOk = s !== 'dodge' || h.stateT >= LOCO.dodgeAttackCancel;       // dodge → attack / jump cancel point
  if (h.buf && cancelOk) {
    if (!h.grounded) {
      // locomotion-dodge r2: an unhurried tap after a swing ended still swings (and re-catches the hover), up to the
      // per-jump cap — was once per jump, so only a mash inside the cancel window kept the hero up. A press in the last
      // metre of a fall stays buffered and comes out as the ground attack on touchdown (dash when running) instead of
      // a knee-high hover.
      if (h.airN < AIR_CHAIN_MAX && (h.vy >= 0 || h.y > 1)) { startMove(h, h.buf === 'attack' ? NEUTRAL.air : NEUTRAL.airCharge, inp, game); return true; }
    } else {
      // dash attack from a run, or out of the landing of a running jump with the stick still held (runT survives the jump)
      const dash = h.runT >= LOCO.dashAfter && (s === 'run' || (s === 'land' && stickDir(inp, game.cam.yaw)[2] > 0));
      if (h.buf === 'attack') startMove(h, dash ? NEUTRAL.dash : NEUTRAL.attack, inp, game);
      else startMove(h, NEUTRAL.charge, inp, game);
      return true;
    }
  }
  if (h.jumpBuf && h.grounded && cancelOk) { h.jumpBuf = 0; startJump(h); }
  return false;
}
