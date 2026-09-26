// Zhao Yun moveset (data only). All timings in 60 Hz sim frames.
//
// move = {
//   frames      total duration (the animation clip is the one with the move's id, anims/attacks.js)
//   anim        clip timing (only for moves whose clip is not frame-keyed to this data in anims/attacks.js): [[frame, clipT, clip?], ...] piecewise linear from move frame to normalised clip time, so a
//               move can hold a chamber, snap a strike and hold a finish pose without re-authoring the clip. `clip`
//               carries over to later keys; two keys on the same frame = a cut (the renderer blends it like a new move).
//               Without `anim` the clip plays linearly over `frames`.
//   next        normal-attack follow-up, charge: charge-attack branch (C2..C6 hang off N1..N5)
//   cancel      frame from which a buffered attack/charge (or jump) starts the next move — the beat of the string
//   branch      N1–N5: frame from which a buffered charge starts the Cn branch — right after the strike, cutting the
//               follow-through (DW8XL: N1 trail f163–166 → C2 flash f167, N2 f294–297 → C3 f299, N3 f53–56 → C4 f57)
//   dodgeCancel frame from which dodge cancels the move (also during the wind-up, before the first active frame)
//   lunge       [[f0, f1, metres, 'lin'?], ...] forward displacement along the facing, eased out (or linear)
//   steer       frames at the start during which the hero may still turn toward the stick / soft-lock target
//   armor       hyper armour vs officers too (grunt hits never flinch an attacking hero)
//   air         performed in the air (hover: upward speed set on start so air strings hang), landFrame: on touchdown
//               jump to this frame and hold landFrame-1 while still airborne (plunges, vaults)
//   leap        [frame, vy] take off mid-move · hang [f0, f1] zero vertical speed · plunge [frame, vy] dive down
//   hits: [{ f:[first,last] active frames (inclusive), shape:'arc'|'circle'|'line',
//            arc: range, ang (total degrees), dir (degrees offset, + = left) · circle: range · line: len, width, off
//            dmg, kb:'flinch'|'push'|'launch'|'blow'|'spin'|'slam', force (m/s horizontal), lift (m/s up),
//            hitstop (frames), every (re-hit interval inside the window, 0 = once), yMax (air reach), heavy,
//            pillars / rocks: count of gold light pillars / boulders the vfx raises when this heavy circle window opens,
//            sweep: ±1 resolve the window in swing order (+1 right → left, −1 left → right; a circle starts at dir + 180°
//            for −1): the sector grows from the start side over sweepN frames (default: the window), one hero hitstop }]
// }
//
// Reach (N1–N6): hit ranges follow the spear tip's sweep in anims/attacks.js (tip ≈ 2.1–2.3 m from the hero, N4's
// one-handed sweep 3 m) plus a little; combat adds the enemy radius (0.4 m). The clip's contact pose sits on hits[].f[0].
// Coverage (r4): each arc is the ground footprint of its clip's blade path, not a half disc — N1's chop lands in a narrow
// wedge front-right, N2 rises right → left, N3 is the widest low sweep, N4 the shoulder sweep, N6 the full spin. Sweeps
// resolve in blade order (`sweep`), so a normal catches ~3–8 of a packed ring one or two at a time (bench: +1…+4 per
// swing, DW9 sparks on 1–3 soldiers) and a finisher still clears 15–45.
//
// Timing targets (bench/BENCHMARK.md, combo-system): N1–N6 hit onsets 25, 26, 24, 26 sf apart, then the late N6 accent
// 35 sf after N5 (DW8XL audio onsets 26, 28, 22, 26, 34), with a held finish pose. Onset spacing = cancel_k + tell_k+1 −
// tell_k; light moves absorb their hitstop into the beat (combo.js beatOk), so the spacing is the same in an empty field
// and a packed ring. First active 8 sf after input from idle (5 sf chamber + hold); ~4.5 m travel over the
// string, surging on N2/N4/N6. Charges: tell (charge start → first active) C1 25, C2 16, C3 13, C4 24, C5 24, C6 10.
// Charges are a commitment, not a flick (bench/notes/charge-attacks.md): tell → strike → HELD pose → delayed ground wave
// → recovery, so start → idle incl. hitstop lands in the ±20 % band of DW8XL: C1 64, C2 126 (vault apex ≈ 3 m),
// C3 142 (slam, then the gold pillar ring), C4 86 (bench holds the extension 26 sf), C5 90, C6 168 (plunge, then the eruption).
// Dash (≈94 sf): three advancing spins ~16 sf apart at run speed, then a lunge thrust. Jump charge: ≈0.5 s apex hang, then a
// ≤ 2 sf plunge (takeoff → impact 54 sf for any press on the rise). Jump attack: a swipe every 12 sf while hovering.
// Charges keep cancel within 13 sf of `frames` so a press buffered during the hold (BUF = 14) survives to the end.
// dodgeCancel = the frame after the last active window (the delayed ground wave included), so a dodge never cuts a strike
// but comes out as soon as the move has delivered.
// every: ONCE → the window resolves in a single tick on its first frame (each enemy once, one hitstop); the rest of the
// window only keeps the spear trail open. Without it every frame that catches a newcomer re-triggers the full hitstop,
// which stretched finishers by up to 4× their hitstop and knocked the string off the beat.
const ONCE = 99;
export const MOVES = {
  // N1 overhead diagonal chop: chamber 5, hold 1, strike 4, follow-through held → next hit on the beat
  n1: { frames: 35, next: 'n2', charge: 'c2', cancel: 23, branch: 11, dodgeCancel: 11, steer: 5, lunge: [[2, 9, 0.3]],
    hits: [{ f: [7, 10], every: ONCE, shape: 'arc', range: 2.5, ang: 110, dir: -20, dmg: 12, kb: 'flinch', force: 3, hitstop: 3 }] },
  // N2 step-in backhand rising sweep (starts from N1's left-side follow-through, so no return to stance)
  n2: { frames: 35, next: 'n3', charge: 'c3', cancel: 25, branch: 13, dodgeCancel: 13, steer: 4, lunge: [[0, 9, 0.8]],
    hits: [{ f: [9, 12], sweep: 1, shape: 'arc', range: 2.4, ang: 130, dir: 10, dmg: 12, kb: 'flinch', force: 3, hitstop: 3 }] },
  // N3 flat low sweep, chambered at the right hip (the widest arc of the string, bench N3 catches 3–5)
  n3: { frames: 30, next: 'n4', charge: 'c4', cancel: 20, branch: 14, dodgeCancel: 14, steer: 5, lunge: [[7, 12, 0.4]],
    hits: [{ f: [10, 13], sweep: 1, shape: 'arc', range: 2.4, ang: 170, dir: 20, dmg: 14, kb: 'push', force: 6, hitstop: 3 }] },
  // N4 run-in, overhead carry round behind the head, shoulder-high sweep right → left (the string's first surge); N3 flows straight into a 14 sf run-in (bench: 16 sf)
  n4: { frames: 38, next: 'n5', charge: 'c5', cancel: 28, branch: 24, dodgeCancel: 17, steer: 6, lunge: [[0, 14, 1.3]],
    hits: [{ f: [14, 23], sweep: 1, sweepN: 5, shape: 'arc', range: 2.6, ang: 160, dir: 25, dmg: 14, kb: 'flinch', force: 4, hitstop: 3 }] },
  // N5 over-shoulder windup (12 sf, bench: 16), chop, twirl whipped out level, whip round into N6's late accent
  n5: { frames: 50, next: 'n6', charge: 'c6', cancel: 32, branch: 22, dodgeCancel: 22, steer: 4, lunge: [[8, 12, 0.15], [16, 20, 0.2]],
    hits: [{ f: [12, 14], every: ONCE, shape: 'line', len: 2.3, width: 1.2, dmg: 10, kb: 'flinch', force: 3, hitstop: 2 },
      { f: [19, 21], every: ONCE, shape: 'arc', range: 2.2, ang: 120, dir: -20, dmg: 12, kb: 'push', force: 5, hitstop: 3 }] },
  // N6 late accent: hop-lunge overhead slam, shockwave ring, finish pose held ≈ 22 sf incl. hitstop (bench 18) before a
  // mash restarts the string; idle 48 sf after N6 starts (bench: finish hold 9 f + return 7 f)
  n6: { frames: 48, next: 'n1', charge: 'c1', cancel: 38, dodgeCancel: 19, steer: 6, lunge: [[3, 14, 1.4]], armor: true,
    hits: [{ f: [15, 18], sweep: -1, dir: -180, shape: 'circle', range: 2.4, dmg: 26, kb: 'blow', force: 12, lift: 6, hitstop: 7, heavy: true }] },

  // C1 (from neutral) rising launcher: crouch with the spear low, hold the tell, rip upward, hold the extended spear
  // (bench: thrust at 28 sf, back in stance at 64)
  c1: { frames: 56, cancel: 50, dodgeCancel: 29, steer: 12, lunge: [[22, 28, 0.8]], armor: true,
    hits: [{ f: [25, 29], every: ONCE, shape: 'arc', range: 3.8, ang: 170, dmg: 18, kb: 'launch', force: 2, lift: 10, hitstop: 6, heavy: true }] },
  // C2 (N1 → C) launcher thrust (+ gold pillar), then a high vault after the launched group: leap 13 m/s → apex ≈ 3 m
  // (1.6 H) at ≈ 54, air sweeps around the apex, touchdown ≈ 82, held landing crouch (bench: vault 42→90, neutral 126)
  c2: { frames: 112, cancel: 104, dodgeCancel: 84, steer: 10, lunge: [[4, 16, 0.8], [26, 80, 2.4]], armor: true,
    leap: [26, 13], landFrame: 84,
    // integration r1: ground launcher and landing play spear-anim's frame-keyed c2 clip; the sim leap cuts to jatk for
    // the air sweep (spear-anim's in-pose pole vault would stack on top of the real leap height). Values = clip frame / 112.
    anim: [[0, 0], [24, 24 / 112], [26, 0.1, 'jatk'], [40, 0.2], [47, 0.42], [64, 0.8], [83, 0.9],
      [83, 100 / 112, 'c2'], [84, 104 / 112], [104, 104 / 112], [112, 1]],
    hits: [{ f: [16, 19], every: ONCE, shape: 'line', len: 4.4, width: 2.4, dmg: 18, kb: 'launch', force: 3, lift: 11, hitstop: 5, heavy: true },
      { f: [46, 58], every: 6, shape: 'circle', range: 3.6, dmg: 10, kb: 'launch', force: 3, lift: 5, hitstop: 2, yMax: 5.5 }] },
  // C3 (N2 → C) stepping thrust flurry (the twirl, 30 sf), cocked overhead, ground slam, HOLD the slam while the gold
  // pillar ring erupts ~20 sf later (bench: twirl 16–56, slam 58–74, dark arc, pillars 96–124, neutral 142)
  c3: { frames: 114, cancel: 104, dodgeCancel: 77, steer: 12, lunge: [[11, 43, 1.4], [49, 53, 1.0]], armor: true,
    hits: [{ f: [13, 43], shape: 'line', len: 4.2, width: 2.4, dmg: 6, kb: 'flinch', force: 1.5, hitstop: 1, every: 6 },
      { f: [52, 55], every: ONCE, shape: 'arc', range: 3.6, ang: 200, dmg: 16, kb: 'flinch', force: 3, hitstop: 6, heavy: true },
      // the delayed ground wave (attack:swing win 2): gold pillar ring (vfx `pillars`) that launches the whole ring
      { f: [74, 77], every: ONCE, shape: 'circle', range: 3.8, dmg: 26, kb: 'launch', force: 3, lift: 10, hitstop: 8, heavy: true, pillars: 9 }] },
  // C4 (N3 → C) spear level overhead (tell), 360° sweeps (3 ticks), then the extended spear HELD ~18 sf before the
  // return (bench: sweep 26–34, held f74–86 = 26 sf, neutral 86). Window end e = 52 keeps the clip's hold key (e − 4)
  // after its second turn (s + 19).
  c4: { frames: 76, cancel: 66, dodgeCancel: 52, steer: 16, lunge: [[22, 38, 0.8]], armor: true,
    hits: [{ f: [24, 52], shape: 'circle', range: 4.2, dmg: 11, kb: 'spin', force: 6, lift: 3, hitstop: 3, every: 10 }] },
  // C5 (N4 → C) deep crouch, slow sliding low sweep (staggers the ring in place), upswing, then the burst of rays that
  // launches everything around (bench: low sweep 20–40, upswing 42–50, ray fan at 52, neutral 90).
  // anim stretches the clip's sweep (clip frames 12 → 22) over 14 → 38; values = clip frame / 80.
  c5: { frames: 80, cancel: 72, dodgeCancel: 54, steer: 12, lunge: [[14, 40, 2.4]], armor: true,
    anim: [[0, 0], [14, 12 / 80], [38, 22 / 80], [44, 44 / 80], [80, 1]],
    hits: [{ f: [24, 27], every: ONCE, shape: 'circle', range: 3.2, dmg: 8, kb: 'flinch', force: 2, hitstop: 2 },
      { f: [50, 54], every: ONCE, shape: 'circle', range: 4.6, dmg: 26, kb: 'launch', force: 5, lift: 9, hitstop: 8, heavy: true }] },
  // C6 (N5 → C) rising slash into a ~1 s whirlwind that staggers the ring in place (multi-hit tint, as in the bench
  // crowd demo), leap (≈1.1 m), plunge, impact that pops the ring up, then the rock eruption 10 sf later blasts it
  // outward (bench: twirl 32–92, leap 94, plunge 102, eruption 108–164, neutral 168)
  c6: { frames: 130, cancel: 120, dodgeCancel: 95, steer: 8, lunge: [[10, 66, 1.8], [72, 82, 0.8]], armor: true,
    leap: [72, 11], plunge: [80, -26], landFrame: 82,
    hits: [{ f: [10, 62], shape: 'circle', range: 3.6, dmg: 5, kb: 'flinch', force: 0.8, hitstop: 1, every: 10, yMax: 4 },
      { f: [82, 85], every: ONCE, shape: 'circle', range: 4.2, dmg: 18, kb: 'launch', force: 3, lift: 8, hitstop: 6, heavy: true, yMax: 4 },
      // the delayed ground wave (attack:swing win 2): rock eruption (vfx `rocks`)
      { f: [92, 95], every: ONCE, shape: 'circle', range: 5.2, dmg: 30, kb: 'blow', force: 15, lift: 7, hitstop: 8, heavy: true, yMax: 4.5, rocks: 18 }] },

  // Dash attack (run + attack): three advancing spin sweeps ~15 sf apart at run speed (8.5 m/s until 43), then a lunge
  // thrust and the recovery (bench: 3 spins ≈ 16 sf apart, lunge thrust with dust, neutral ≈ 94). A mobility move: a
  // dodge may cut the thrust and recovery once the spins are done.
  dash: { frames: 88, cancel: 80, dodgeCancel: 40, steer: 3, lunge: [[0, 43, 6.1, 'lin'], [43, 56, 2.2]],
    anim: [[0, 0.1, 'n4'], [3, 0.3], [13, 0.72], [18, 0.72], [18, 0.3], [28, 0.72], [33, 0.72], [33, 0.3], [43, 0.72],
      [43, 0, 'dash'], [48, 0.18], [64, 0.45], [88, 1]],
    hits: [{ f: [5, 8], every: ONCE, shape: 'circle', range: 3.2, dmg: 10, kb: 'flinch', force: 4, hitstop: 2 },
      { f: [20, 23], every: ONCE, shape: 'circle', range: 3.2, dmg: 10, kb: 'flinch', force: 4, hitstop: 2 },
      { f: [35, 38], every: ONCE, shape: 'circle', range: 3.2, dmg: 12, kb: 'push', force: 6, hitstop: 2 },
      { f: [47, 52], every: ONCE, shape: 'line', len: 4.2, width: 2.2, dmg: 20, kb: 'blow', force: 11, lift: 4, hitstop: 5, heavy: true }] },
  // Jump attack: a diagonal swipe every 12 sf while mashing; each swipe re-lifts the hero so the string hovers
  jatk: { frames: 22, air: true, hover: 2.6, next: 'jatk', charge: 'jc', cancel: 12, dodgeCancel: 99, steer: 3,
    anim: [[0, 0], [4, 0.2], [9, 0.42], [22, 1]],
    hits: [{ f: [5, 9], every: ONCE, shape: 'arc', range: 3.6, ang: 220, dmg: 12, kb: 'flinch', force: 3, hitstop: 2, yMax: 4.5 }] },
  // Jump charge: raise the spear (tell) while the jump finishes its own rise (combo holds frame hang[0] until the apex),
  // hang ≈ 26 sf at the apex, plunge in ≤ 3 sf, shockwave on landing, crouch (bench: DW8 A→Y apex 1.3–1.6 H at ≈ 27 sf,
  // hangs 12 f@30 (24 sf), 1-frame plunge, takeoff → impact 0.92 s)
  // integration r2: locomotion-dodge's apex hang + fast plunge, combo-system's post-impact crouch length
  jc: { frames: 56, air: true, hover: 3, landFrame: 36, hang: [6, 32], plunge: [32, -80], cancel: 50, dodgeCancel: 39, steer: 12, armor: true,
    hits: [{ f: [36, 39], every: ONCE, shape: 'circle', range: 4.4, dmg: 22, kb: 'launch', force: 5, lift: 8, hitstop: 7, heavy: true }] },
};

// Re-used by the combo system: what C1 hangs off (charge from neutral).
export const NEUTRAL = { attack: 'n1', charge: 'c1', dash: 'dash', air: 'jatk', airCharge: 'jc' };
export const AIR_CHAIN_MAX = 10;  // swipes per jump (the rapid DW8 jump attack shows ~10 over 2.9 s; locomotion-dodge r2: 8 → 10)

for (const [id, m] of Object.entries(MOVES)) {
  m.id = id; m.lunge = m.lunge || [];
  m.tell = m.hits[0].f[0];                                  // start → first active frame (charge tell length)
  if (m.anim) {                                             // fill carried-over clip ids and cut-segment indices
    let clip = id, seg = 0;
    m.anim.forEach((k, i) => {
      if (i && k[0] === m.anim[i - 1][0]) seg++;
      else if (i && k[2] && k[2] !== clip) seg++;
      clip = k[2] = k[2] || clip; k[3] = seg;
    });
  }
}

/** Forward displacement (m) the lunge has applied by move frame f: each segment eased out (or linear), clamped to it. */
export function lungeAt(m, f) {
  let d = 0;
  for (const [a, b, dist, e] of m.lunge) {
    const u = Math.min(1, Math.max(0, (f - a) / (b - a)));
    d += dist * (e === 'lin' ? u : 1 - (1 - u) * (1 - u));
  }
  return d;
}

/** Clip sample for move frame t → [clipId, normalised clip time, segment]. Pure, used by the hero's anim bookkeeping. */
export function moveClip(m, t) {
  const a = m.anim;
  if (!a) return [m.id, t / m.frames, 0];
  let i = 0;
  while (i < a.length - 1 && a[i + 1][0] <= t) i++;
  const k = a[i], n = a[i + 1];
  if (!n || n[3] !== k[3] || t <= k[0]) return [k[2], k[1], k[3]];
  return [k[2], k[1] + (n[1] - k[1]) * (t - k[0]) / (n[0] - k[0]), k[3]];
}

