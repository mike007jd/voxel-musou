// Camera. Sim side (game.cam, deterministic): the view yaw, which drifts behind the running hero over ≈1 s, re-frames
// once, eased, toward the fight when the view has lost it while he attacks (never while idle, hurt, running or after a
// manual look) and otherwise holds still, and an input frame lock (the stick keeps the frame it was pressed in), so the
// view can swing without bending his path.
// Render side: DW8-style low third-person follow (hero ≈ 45 % of frame height, feet near the bottom, rigid position
// follow with velocity lead), combat framing (pull out and tilt up slightly in dense crowds so the castle skyline stays in frame, slight aim bias toward the
// nearby mob, hero held near the centre), event-driven micro-kicks only on heavy hits (none on normal hits) and Musou
// choreography.
// Render smoothing uses sim time elapsed between renders and shake uses sim frames, so captures are deterministic.
import * as THREE from 'three';
import { on } from '../core/events.js';
import { ST } from '../crowd/crowd.js';

const DEG = Math.PI / 180;
const BLEND = 0.45;                                   // s, Musou → gameplay blend (bench: 0.3-0.6 s, no pop)
const CAM = {
  // Default rig from bench/notes/camera-hud-world.md (DW8): vFOV 40°, ≈4.9 m behind and 2.9 m above the feet, pitch
  // ≈14.6°, aim crossing the hero at 1.62 m → hero ≈ 45 % of frame height, feet ≈ 89 %, horizon ≈ 14 %.
  dist: 5.06, height: 1.62, pitch: 14.6 * DEG, fov: 40,
  follow: 18, followY: 20,  // position follow rates (1/s): re-centres in ≈0.2 s; a velocity lead removes the run lag
  airLift: 0.7, airTilt: 0.03, // aerial: aim rises 0.7 m per m of hero height and the view tilts up 0.03 rad per m
  yawLerp: 12,              // render smoothing of the sim view yaw (manual orbit)
  drift: 1.1, driftMax: 1.2, // sim: view realigns behind the running hero at this rate (1/s), capped (rad/s): bench ≈ 1 s, lazy
  fightDrift: 0.7, fightMax: 0.6, // … and slower while he duels a few soldiers (a mob holds the view instead)
  // sim: fight-aware yaw — only while he attacks, one deliberate re-frame when the view covers under seekShare of the
  // soldiers (within seekR m) the best view would (attack pressed hands-off the stick; otherwise under seekShareLost:
  // the view has lost the fight) and that view is ≥ seekIn away. Eased in/out at seekAcc rad/s², ≤ seekMax rad/s
  // (r4: ≈ 11 px/frame at 720p = bench pan p90, was 22; a slow drift, never a whip), braked at seekBrake when he stops attacking, then none for
  // seekCool frames (lookHold after a manual look). seekW = Σw range over which a mob counts (≈ 5 → 12 soldiers)
  seekR: 10, seekShare: 0.35, seekShareLost: 0.08, seekIn: 30 * DEG, seekMax: 0.6, seekAcc: 1.2, seekBrake: 5, seekCool: 45,
  seekW: [2.5, 5], lookHold: 150,
  lockTol: 0.35,            // stick direction change (rad) that re-anchors the control frame to the view
  crowdR: 10, crowdPull: 0.12, crowdPitch: -2.5 * DEG, // dense crowd (> ~40 within crowdR m): pull out 12 % (bench 10-15 %: hero stays ≥ 41 % H), look up 2.5° (frame top ≈ 7.9° above level: castle wall top + towers stay in)
  biasR: 8, biasMax: 0.18,  // aim bias toward the nearby mob: radius (m), max lateral shift (m) → hero stays at x 47-53 %
  leadYMax: 2, leadYRate: 45, // aerial vertical lead: cap (m) and smoothing (1/s): the jump-charge plunge pans ≤ 56 px/frame, feet in frame
  kickMaxPx: 4,             // shake ceiling at 720p (bench: ≤ 4 px, finishers only)
  cutJump: 40,              // hero moved faster than this (m/s, ≥ 1 m) between two renders: teleport → hard cut (dodge 22)
};

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const { clamp } = THREE.MathUtils;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** Camera offset from its aim point: `dist` back along view yaw, raised by `pitch`. */
const behind = (v, yaw, pitch, dist) => v.set(-Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, -Math.cos(yaw) * Math.cos(pitch) * dist);

/**
 * View coverage (sim, deterministic): the live soldiers within seekR of the hero (w = 1 − d/R, officers ×4, downed
 * ones skipped) binned by bearing off `yaw`; a view centred on bin k covers bins k ± 3 (≈ ±52°, the edge bins half).
 * Returns [Σw, weight the current view covers, the best view's weight, turn to the nearest view within 85 % of the
 * best (rad)]. A ring all round the hero scores the same everywhere, so it never asks for a turn.
 */
const NB = 24, BW = 2 * Math.PI / NB, hist = new Float64Array(NB);
function coverage(game, yaw) {
  const c = game.crowd, h = game.hero, R = CAM.seekR;
  let W = 0;
  hist.fill(0);
  for (let i = 0; i < c.N; i++) {
    const st = c.st[i];
    if (st === ST.OFF || st === ST.DEAD || st === ST.DOWN) continue;
    const dx = c.x[i] - h.x, dz = c.z[i] - h.z;
    if (dx > R || dx < -R || dz > R || dz < -R) continue;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d >= R) continue;
    const w = (1 - d / R) * (c.type[i] ? 4 : 1);
    hist[(Math.round(wrap(Math.atan2(dx, dz) - yaw) / BW) + NB) % NB] += w; W += w;
  }
  let best = 0, cur = 0, turn = 0;
  const score = (k) => { let v = 0; for (let j = -3; j <= 3; j++) v += hist[(k + j + NB) % NB] * (j === 3 || j === -3 ? 0.5 : 1); return v; };
  for (let k = 0; k < NB; k++) best = Math.max(best, score(k));
  cur = score(0);
  for (let m = 0; m <= NB / 2; m++) {                        // nearest good view: search outward from the current one
    if (score(m) >= 0.85 * best) { turn = m * BW; break; }
    if (score((NB - m) % NB) >= 0.85 * best) { turn = -m * BW; break; }
  }
  return [W, cur, best, turn];
}

/**
 * Sim-side camera state (lives in game.cam). `yaw` = where the camera looks (the HUD minimap and every stickDir() caller
 * read it). `ctrl` = the control frame the stick is relative to: re-anchored to `yaw` whenever the stick is released or
 * changes direction, otherwise held, and step() rotates the sampled stick by (yaw − ctrl) so that movement code, which
 * reads the stick relative to `yaw`, keeps running straight while the view swings round behind the hero.
 */
export function createCamSim() {
  // eng: the current attack was pressed with the stick released, seek: a re-frame is under way toward the yaw seekTo,
  // seekV: its yaw rate (rad/s), seekCd: frames before the next re-frame may start
  const s = { yaw: 0, ctrl: 0, manualT: 0, lockAng: null, hx: null, hz: null, look: false, eng: false, seek: false, seekTo: 0, seekV: 0, seekCd: 0 };
  s.reset = (yaw = 0) => {
    s.yaw = s.ctrl = yaw; s.manualT = 0; s.lockAng = null; s.hx = s.hz = null; s.look = false;
    s.eng = s.seek = false; s.seekTo = s.seekV = s.seekCd = 0;
  };
  s.step = (game, inp) => {
    const h = game.hero;
    const held = Math.hypot(inp.mx, inp.my) >= 0.1;
    // hero ground speed since the last step (lunges move him directly): the view does not turn while he dashes through
    const v = s.hx == null ? 0 : Math.hypot(h.x - s.hx, h.z - s.hz) * 60;
    s.hx = h.x; s.hz = h.z;
    // a manual look (orbit) holds the seek and the fight drift off until he moves again (r4: attacking in place keeps
    // the player's view; being hit does not count either)
    if (h.state === 'run' || h.state === 'dodge' || h.state === 'jump') s.look = false;
    if (inp.pressed.attack || inp.pressed.charge) s.eng = !held;          // this attack was pressed hands-off the stick
    if (s.seekCd > 0) s.seekCd--;
    // a manual look also holds re-frames off for lookHold frames after the stick is let go (the player's view wins)
    if (inp.orbit) { s.yaw += inp.orbit; s.ctrl += inp.orbit; s.manualT = 90; s.look = true; s.seek = false; s.seekV = 0; s.seekCd = CAM.lookHold; }
    else if (s.manualT > 0) s.manualT--;
    else if (h.state === 'musou') { s.yaw += wrap(h.yaw - s.yaw) * 0.08; s.seek = false; s.seekV = 0; }   // Musou chase: end up behind him
    else {
      // Fight-aware yaw: while he attacks and the view shows under half the soldiers the best view around him would
      // (stick released since the press; else only when it shows almost none of the fight: he ran past the mob), the
      // view re-frames once toward the nearest good view: a latched target, eased in and out (trapezoid: seekAcc,
      // ≤ seekMax), then it holds for seekCool frames. Idle, hurt, running, dodging or a manual look never start one
      // and brake one under way: the view never moves on its own.
      const may = h.state === 'attack' && !s.look;
      const [W, cur, best, turn] = may ? coverage(game, s.yaw) : [0, 0, 0, 0];
      const mob = smooth(CAM.seekW[0], CAM.seekW[1], W);
      const lost = cur < (s.eng && !held ? CAM.seekShare : CAM.seekShareLost) * best;
      if (!s.seek && may && !s.seekCd && mob > 0.5 && lost && Math.abs(turn) >= CAM.seekIn && v < 4) {
        s.seek = true; s.seekTo = wrap(s.yaw + turn);
      }
      let want = 0, acc = CAM.seekBrake;
      if (s.seek) {
        const rem = wrap(s.seekTo - s.yaw);
        if (!may || (Math.abs(rem) < 0.01 && Math.abs(s.seekV) < 0.15)) { s.seek = false; s.seekCd = CAM.seekCool; }
        else { want = Math.sign(rem) * Math.min(CAM.seekMax, Math.sqrt(2 * CAM.seekAcc * Math.abs(rem))); acc = CAM.seekAcc; }
      }
      s.seekV += clamp(want - s.seekV, -acc / 60, acc / 60);
      s.yaw += s.seekV / 60;
      if (h.state === 'run' || (h.state === 'attack' && !s.look)) {
        // lazy realign behind the hero; fades out when he faces the camera (never whips around). In a mob the view
        // holds (the seek above frames it): only duels with a few soldiers follow his facing.
        const run = h.state === 'run', d = wrap(h.yaw - s.yaw);
        const kd = smooth(2.6, 2.0, Math.abs(d)) * (run ? Math.min(1, h.speed / 5) : 1 - mob);
        const max = run ? CAM.driftMax : CAM.fightMax;
        s.yaw += clamp(d * (run ? CAM.drift : CAM.fightDrift), -max, max) * kd / 60;
      }
    }
    s.yaw = wrap(s.yaw);
    const ang = held ? Math.atan2(inp.mx, inp.my) : 0;
    if (!held || s.lockAng === null || Math.abs(wrap(ang - s.lockAng)) > CAM.lockTol) { s.ctrl = s.yaw; s.lockAng = held ? ang : null; }
    const d = wrap(s.yaw - s.ctrl);
    if (held && d) { const c = Math.cos(d), sn = Math.sin(d), x = inp.mx, y = inp.my; inp.mx = x * c + y * sn; inp.my = y * c - x * sn; }
  };
  return s;
}

export function createCameraRig(game, width, height) {
  const camera = new THREE.PerspectiveCamera(CAM.fov, width / height, 0.1, 1200);
  const target = new THREE.Vector3(), want = new THREE.Vector3(), pos = new THREE.Vector3();
  let yaw = 0, snap = true, blend = 0, warned = false;
  let cine = null;                                // { phase: current musou shot id } while a Musou plays
  let pull = 0, bias = 0, leadYs = 0;             // smoothed crowd pull-out (fraction), lateral aim bias (m), aerial lead (m)
  let lastX = 0, lastZ = 0;                        // hero ground position at the previous render (teleport → snap)
  // micro-kicks: screen-space px at 720p, fired by events, aged in sim frames (deterministic)
  const kicks = [];
  const kick = (px, dirX, dirY, len) => {
    const last = kicks[kicks.length - 1];
    if (last && game.frame - last.f < 3 && last.px >= px) return;          // one kick per impact, not per tick
    kicks.push({ f: game.frame, px, dirX, dirY, len });
    if (kicks.length > 4) kicks.shift();
  };
  on('hits', (e) => { if (e.heavy) kick(Math.min(3, 1.6 + e.count * 0.12), 0.25, 1, 6); });   // finishers only
  on('hero:hurt', (e) => kick(e.armored ? 0.6 : 1.5, 1, 0.3, e.armored ? 4 : 6));
  on('land', (e) => e.hard && kick(2, 0, 1, 6));
  on('musou:burst', () => kick(4, 0.3, 1, 10));
  on('musou:start', () => { cine = { phase: -1 }; });
  on('musou:end', () => { cine = null; blend = BLEND; });                  // eased blend back to the gameplay rig

  /** Nearby-crowd stats around the hero (render-side read of sim arrays): count within crowdR and lateral pull. */
  function crowdAround(h, rx, rz) {
    const c = game.crowd, R2 = CAM.crowdR * CAM.crowdR;
    let n = 0, wsum = 0, lat = 0;
    for (let i = 0; i < c.N; i++) {
      const s = c.st[i];
      if (s === ST.OFF || s === ST.DEAD || s === ST.DOWN) continue;
      const dx = c.x[i] - h.x, dz = c.z[i] - h.z, d2 = dx * dx + dz * dz;
      if (d2 > R2) continue;
      n++;
      const d = Math.sqrt(d2);
      if (d < CAM.biasR) { const w = 1 - d / CAM.biasR; wsum += w; lat += w * (dx * rx + dz * rz); }
    }
    return [n, wsum > 0.5 ? lat / wsum : 0];
  }

  const api = {
    camera,
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    update(dt) {
      const h = game.hero;
      // a teleport is a cut, not a 6-frame swoop across the screen
      if (Math.hypot(h.x - lastX, h.z - lastZ) > Math.max(1, CAM.cutJump * dt)) snap = true;
      lastX = h.x; lastZ = h.z;
      let camYaw = game.cam.yaw;
      let dist = CAM.dist, pitch = CAM.pitch, fov = CAM.fov, height = CAM.height, side = 0, shakeK = 1;
      // Musou choreography is owned by the musou part: game.musou.shot() returns the shot for the current musou
      // frame (pose → close-up → chase → payoff); a new shot id is a hard cut. `side` shifts the aim to screen-right.
      const shot = cine && game.musou.shot();
      if (shot) {
        if (shot.id !== cine.phase) { cine.phase = shot.id; snap = true; }
        ({ yaw: camYaw, dist, pitch, fov, height, side, shake: shakeK } = shot);
      }
      const ky = 1 - Math.exp(-CAM.yawLerp * dt);
      yaw = snap ? camYaw : yaw + wrap(camYaw - yaw) * ky;
      // combat framing (gameplay rig only): pull out in dense crowds, bias the aim toward the nearby mob
      const rx = -Math.cos(yaw), rz = Math.sin(yaw);                        // screen-right on the ground
      if (!cine) {
        const [n, lat] = crowdAround(h, rx, rz);
        const kp = snap ? 1 : 1 - Math.exp(-1.2 * dt), kb = snap ? 1 : 1 - Math.exp(-1.5 * dt);
        pull += (smooth(18, 42, n) * CAM.crowdPull - pull) * kp;
        bias += (clamp(lat * 0.2, -CAM.biasMax, CAM.biasMax) - bias) * kb;
        dist *= 1 + pull;
        pitch += pull / CAM.crowdPull * CAM.crowdPitch - h.y * CAM.airTilt; // dense: keep the castle skyline in; aerial: tilt up
      }
      // Blend step toward the gameplay pose: the remaining share of the gap eases out as smoothstep(blend / BLEND), so
      // each render closes 1 − rest_after / rest_before of it. (The old form (e1 − e0) / (1 − e0) went 0/0 = NaN when
      // real-time dt left a ~1e-17 s remainder on the last step, and the NaN stuck in `pos` for good.)
      let bk = 1;
      if (blend > 0) {
        const rest = smooth(0, BLEND, blend);
        blend = Math.max(0, blend - dt);
        bk = rest > 0 ? 1 - smooth(0, BLEND, blend) / rest : 1;
      }
      const lat = shot ? side : bias;                                      // musou shot: its own screen-right offset
      // velocity lead v/follow cancels the exponential follow's steady lag (≈0.47 m at a run): the running hero stays
      // centred and the camera backs off in time when he runs at it (lunges and rolls still ease in)
      const lead = shot ? 0 : 1 / CAM.follow, lift = shot ? 0.6 : CAM.airLift;
      // … and the fall after a jump (feet stay in frame): capped and eased, so the plunge start/landing is not a jolt
      const leadY = shot || h.grounded ? 0 : clamp(h.vy * lift / CAM.followY, -CAM.leadYMax, CAM.leadYMax);
      leadYs = snap ? leadY : leadYs + (leadY - leadYs) * (1 - Math.exp(-CAM.leadYRate * dt));
      target.set(h.x + rx * lat + h.vx * lead, h.y * lift + height + leadYs, h.z + rz * lat + h.vz * lead);
      const kxz = snap ? 1 : 1 - Math.exp(-CAM.follow * dt), kyv = snap ? 1 : 1 - Math.exp(-CAM.followY * dt);
      if (snap) api.focus.copy(target);
      else { api.focus.x += (target.x - api.focus.x) * kxz; api.focus.z += (target.z - api.focus.z) * kxz; api.focus.y += (target.y - api.focus.y) * kyv; }
      behind(want, yaw, pitch, dist).add(api.focus);
      if (snap) { pos.copy(want); camera.fov = fov; }
      else { pos.lerp(want, bk); camera.fov += (fov - camera.fov) * (bk < 1 ? bk : 1 - Math.exp(-8 * dt)); }
      snap = false;
      if (!Number.isFinite(pos.x + pos.y + pos.z + api.focus.x + api.focus.y + api.focus.z + camera.fov)) {
        // last-resort guard: never let a non-finite pose stick (blank fog forever) — snap to the default follow pose
        if (!warned) { warned = true; console.error('camera: non-finite rig state, snapped to the default follow pose', { yaw, bk, pull, bias }); }
        yaw = game.cam.yaw; pull = bias = blend = 0;
        api.focus.set(h.x, h.y * CAM.airLift + CAM.height, h.z);
        behind(pos, yaw, CAM.pitch, CAM.dist).add(api.focus);
        camera.fov = CAM.fov;
      }
      camera.position.copy(pos);
      camera.lookAt(api.focus);
      // micro-kicks: damped one-rebound thump, rotation in screen space, ≤ kickMaxPx
      let sx = 0, sy = 0;
      for (let i = kicks.length - 1; i >= 0; i--) {
        const k = kicks[i], age = game.frame - k.f;
        if (age > k.len) { kicks.splice(i, 1); continue; }
        const a = k.px * Math.exp(-age * 3 / k.len) * Math.cos(age * Math.PI / 3);
        sx += a * k.dirX; sy += a * k.dirY;
      }
      sx *= shakeK; sy *= shakeK;                                          // musou shots scale the thumps
      const m = Math.hypot(sx, sy);
      if (m > CAM.kickMaxPx) { sx *= CAM.kickMaxPx / m; sy *= CAM.kickMaxPx / m; }
      if (m > 0) {
        const rad = camera.fov * DEG / 720;                                 // ≈ radians per px at 720p
        camera.rotateX(sy * rad); camera.rotateY(sx * rad);
      }
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
    },
    focus: new THREE.Vector3(),
  };
  return api;
}
