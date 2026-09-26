// Battle audio. Plays the offline-baked bank (bank.js) off bus events:
//  swing whooshes by move shape/weight + Zhao Yun kiai, cued LEAD sim frames before each hitbox window opens (sound leads
//  the trail) · layered slash impacts on the `hits` frame (click + crack + thwack + thump + crunch, armour clank; 3+
//  victims add a body-cluster layer and packed crunch grains) with a post-hitstop "blow-away" release on heavy hits ·
//  enemy grunts, death cries, body falls · dodge / jump / land / hurt · Musou gauge chime, activation flash + shout,
//  close-up hush + charge drone swelling into the contact blast, stab flurry, pre-burst inhale, finishing blast + death
//  chorus · reinforcement horn + army roar · foreground army shouts ·
//  looping distant-battle bed, war drums and a power-chord battle riff that swell with combat
//  intensity and duck under hits and the Musou.
// Mix: sfx / voice / bed buses + convolution reverb send → master EQ (matched to the benchmark clips' octave balance) →
// compressor (25 ms attack: transients pass) → soft-clip ceiling (≈ -2 dBFS, no clipping); ≈ -17 LUFS in crowd-fight
// (benchmark -14 … -19). Impacts own the transient: every hit tick sidechains the whooshes / body falls (under bus), the
// bed, the voices and the reverb return for 50-100 ms — through to the next tick inside a multi-tick window, which builds
// to a heavier last blow — and flurry whoosh pulses land ON their ticks, so multi-tick moves (C3, C4, C6, the Musou
// flurry) read as separate blows instead of a plateau.
// Positional: pan + distance attenuation from the hero, relative to the sim camera yaw. Read-only on the sim; audio
// randomness is Math.random, never the sim RNG. Starts on the first user gesture.
import { on } from '../core/events.js';
import { MOVES } from '../hero/moves.js';
import { buildBank, makeIR, noiseBuf } from './bank.js';

const rnd = (a, b) => a + (b - a) * Math.random();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// Sim frames a swing cue precedes its hitbox window, per whoosh kind: the trail shows from f0-3 and each whoosh must be
// audible 2-4 sf before it (benchmark). Bank whooshes fade in: audible ≈ 1.5 frames in for a thrust, ≈ 3.5 for a slash,
// ≈ 6 for a spin or a heavy swing (peaks ≈ 3 / 6.5 / 8-16 / 12 frames in). The kiai starts KIAI_LEAD frames ahead.
// Cues that fall on the move's first frame fire from attack:start (no rAF lag).
const LEAD = { thrust: 7, slash: 9, spin: 11, heavy: 12 }, KIAI_LEAD = 7;
const kindOf = (w) => (w.heavy ? 'heavy' : w.shape === 'circle' ? 'spin' : w.shape === 'line' ? 'thrust' : 'slash');
// kiai line per move (per hit window); normal hits are voiced with probability VOICE_P
const KIAI = {
  n1: [['ha', 'hah']], n2: [['sei', 'hah']], n3: [['toh', 'tah']], n4: [['hyah']], n5: [['sei', 'ha'], ['tah']], n6: [['seiya']],
  c1: [['hyah', 'haa']], c2: [['tah', 'toh']], c3: [['hah'], ['seiya']], c4: [['uora']], c5: [['haa']], c6: [['uora'], ['seiya']],
  dash: [['hyah']], jatk: [['ha', 'sei']], jc: [['haa']],
};
const VOICE_P = 0.8;
const VOX = 0.72;                 // voice bus: ≈ 6 dB under the sfx stem, so kiai and shouts never mask the impacts
const MIX = 0.66, POST = 0.9;     // master level (≈ -17 LUFS in the crowd-fight scenario), post-compressor gain
// loop gains: idle level, extra at full combat intensity (the mix breathes between fights; hits duck it via SIDE)
const BED = [0.16, 0.4], DRUMS = [0.06, 0.7], MUSIC = [0.18, 0.46];
// sidechain under every hit tick (hits own the transient): [whoosh, bed, voice, reverb return] depth, hold 50 ms + 10 ms
// per extra victim, or up to the next tick of a multi-tick window (Musou flurry: 50 ms under each accented stab)
const SIDE = [0.3, 0.5, 0.45, 0.5], SIDE_MU = [0.25, 0.4, 0.55, 0.4];

export function createAudio(game) {
  let ctx = null, mix, post, ceiling, sfx, vox, bedBus, bedDuck, revIn, bedG, drumG, musicG, live = 0;
  let underBus, sides = [];                   // sfx that yield to impacts (whooshes, body falls) + the sidechain gains
                                              // (under bus, bed, voice, reverb return)
  let muFrame = -1;                           // last sim frame that voiced a Musou tick (several strikes share a frame)
  let mu = null;                              // current Musou timing (musou:start payload, frames)
  let intensity = 0, lastT = performance.now(), drone = null, bedOn = false, nextShout = 0;
  const last = new Map();                     // throttles
  const lastPick = new Map();
  const B = {};                               // filled progressively by the offline bake (combat sounds first)
  buildBank(B).then(startBed, (e) => console.warn('audio bank', e));

  function start() {
    if (ctx) { if (ctx.state !== 'running') ctx.resume(); return; }
    ctx = new AudioContext({ latencyHint: 'interactive' });
    const comp = ctx.createDynamicsCompressor();
    // 25 ms attack: the first frame of every hit passes the compressor untouched (6 ms flattened the impacts); a gentle
    // -6 dB / 2:1 so dense melee still reads louder than a lull (LRA)
    comp.threshold.value = -6; comp.knee.value = 6; comp.ratio.value = 2; comp.attack.value = 0.025; comp.release.value = 0.12;
    const clip = ctx.createWaveShaper(), c = new Float32Array(2048);
    for (let i = 0; i < c.length; i++) {        // linear to 0.7, tanh knee to a 0.79 (-2 dBFS) ceiling: true peak ≤ -1 dBFS with the bright top
      const x = i / (c.length - 1) * 2 - 1, a = Math.abs(x);
      c[i] = Math.sign(x) * (a < 0.7 ? a : 0.7 + 0.09 * Math.tanh((a - 0.7) / 0.09));
    }
    clip.curve = c; clip.oversample = '2x';
    mix = ctx.createGain(); mix.gain.value = MIX;
    post = ctx.createGain(); post.gain.value = POST;
    // master EQ, matched to the benchmark clips' octave balance: less thump (63-125 Hz ran 2 dB hot), less 250 Hz mud,
    // more 500 Hz body and 2-6 kHz bite (500 Hz-4 kHz ran 1.5-3 dB shy), a softer top above 12k
    const eq = [['lowshelf', 140, 0.7, -4], ['peaking', 260, 1, -1], ['peaking', 560, 0.9, 2.5], ['peaking', 3600, 0.7, 3.5], ['highshelf', 12000, 0.7, -3]].map(([type, f, q, g]) => {
      const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = g; return b;
    });
    ceiling = clip;                            // input after the compressor: the Musou riser rides through the inhale here
    eq.reduce((n, b) => n.connect(b), mix).connect(comp).connect(post).connect(clip).connect(ctx.destination);
    sfx = ctx.createGain(); sfx.connect(mix);
    sides = SIDE.map(() => ctx.createGain());
    underBus = ctx.createGain(); underBus.connect(sides[0]).connect(sfx);
    vox = ctx.createGain(); vox.gain.value = VOX; vox.connect(sides[2]).connect(mix);
    const rev = ctx.createConvolver(); rev.buffer = makeIR();
    revIn = ctx.createGain(); revIn.connect(rev); rev.connect(sides[3]).connect(mix);   // the wash ducks under hits too
    bedDuck = ctx.createGain(); bedDuck.connect(mix);
    bedBus = ctx.createGain(); bedBus.connect(sides[1]).connect(bedDuck);
    const bedSend = ctx.createGain(); bedSend.gain.value = 0.4; bedDuck.connect(bedSend).connect(revIn);
    startBed();
  }
  addEventListener('pointerdown', start);
  addEventListener('keydown', start);
  // musou part r3: build the context + graph at boot (it stays 'suspended' until the first key/pointer gesture resumes
  // it). Building it inside the first keydown stalled that frame 0.2-1 s (the first Musou of a session hitched when I
  // was the first key pressed).
  start();

  const ok = () => ctx && ctx.state === 'running';
  /** One-shot buffer → gain → pan → bus (+ reverb send). */
  function play(buf, { gain = 1, rate = 1, pan = 0, delay = 0, send = 0.12, bus = sfx, prio = 0 } = {}) {
    if (!buf || (live > 56 && prio < 1)) return null;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = gain;
    const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1);
    s.connect(g).connect(p).connect(bus);
    if (send) { const r = ctx.createGain(); r.gain.value = send; p.connect(r).connect(revIn); }
    live++; s.onended = () => { live--; };
    s.start(t);
    return s;
  }
  /** Random variant, never the same one twice in a row. */
  function pick(arr) {
    if (!Array.isArray(arr)) return arr;
    let i = Math.floor(Math.random() * arr.length);
    if (arr.length > 1 && i === lastPick.get(arr)) i = (i + 1) % arr.length;
    lastPick.set(arr, i);
    return arr[i];
  }
  function gate(key, ms) {
    const t = performance.now();
    if (t - (last.get(key) || -1e9) < ms) return false;
    last.set(key, t); return true;
  }
  /** Pan + distance gain of a world point, heard from the hero with the sim camera's orientation. */
  function place(x, z) {
    const h = game.hero, yw = game.cam.yaw, dx = x - h.x, dz = z - h.z;
    const right = -dx * Math.cos(yw) + dz * Math.sin(yw);
    return { pan: clamp(right / 7, -0.8, 0.8), att: 1 / (1 + Math.max(0, Math.hypot(dx, dz) - 4) / 7) };
  }
  /** Sidechain: whooshes, bed and voices dip within 4 ms of a hit tick, hold, then recover (tau 80 ms). A tick with more
   *  ticks to come in its window holds the dip up to the next one, so a whole C3 / C4 / C6 train stands on a hushed floor. */
  function side(n, musou, until = 0) {
    const t = ctx.currentTime, D = musou ? SIDE_MU : SIDE;
    const hold = until || (musou ? 0.025 : Math.min(0.1, 0.05 + 0.01 * (n - 1)));
    sides.forEach(({ gain: g }, i) => {
      ramp(g, [[0.004, D[i]]]);
      g.setValueAtTime(D[i], t + 0.004 + hold); g.setTargetAtTime(1, t + 0.004 + hold, musou ? 0.05 : 0.08);
    });
  }
  function duck(depth, hold, rel = 0.18) {
    ramp(bedDuck.gain, [[0.015, depth]]); bedDuck.gain.setTargetAtTime(1, ctx.currentTime + 0.015 + hold, rel);
  }
  function startBed() {
    if (bedOn || !ctx || !B.bed) return;
    bedOn = true;
    const t0 = ctx.currentTime + 0.03;
    const loop = (buf) => {                     // starts silent; frame() fades it to the intensity-driven level
      const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
      const g = ctx.createGain(); g.gain.value = 0;
      s.connect(g).connect(bedBus); s.start(t0); return g;   // same t0: the 16 s music loop stays locked to the 8 s drums
    };
    bedG = loop(B.bed); drumG = loop(B.drums); musicG = loop(B.music);
  }

  // ---- swing cues: read the hero's move clock (read-only) every animation frame
  let seq = -1, seenT = -1;
  function cue(m, t) {
    m.hits.forEach((w, wi) => {
      const lead = LEAD[kindOf(w)], t0 = Math.max(0, w.f[0] - lead);
      if (t === t0) swing(m, w, wi, 0, Math.max(0, Math.min(lead, w.f[0]) - KIAI_LEAD) / 60);
      if (!w.every || w.every >= 99) return;
      // flurry pulses start 3 frames before a tick (a whoosh peaks ≈ 3 frames in, so it lands ON the tick and the gap
      // after it stays clean for the next impact), once the lead whoosh has run out (thrust ≈ 8 frames, spin ≈ 25)
      const line = w.shape === 'line', step = line ? Math.max(w.every, 4) : Math.max(w.every * 2, 10), p0 = w.f[0] - 3;
      if (t > t0 + (line ? 6 : 18) && t <= w.f[1] - 3 && (t - p0) % step === 0) swing(m, w, wi, (t - p0) / step);
    });
  }
  function swing(m, w, wi, k, kiaiDelay = 0) {
    const kind = B[kindOf(w)];
    // flurry pulses (k > 0) stay quiet: the hit ticks carry the rhythm, the whoosh only keeps the air moving
    play(pick(kind), { gain: k ? 0.3 : 0.85, rate: rnd(0.94, 1.06) * (k ? rnd(1, 1.12) : 1), pan: rnd(-0.12, 0.12), send: k ? 0.06 : 0.14, bus: underBus, prio: 1 });
    if (k) return;
    const lines = KIAI[m.id] && (KIAI[m.id][wi] || null);
    if (!lines || (!w.heavy && m.id[0] === 'n' && m.id !== 'n6' && Math.random() > VOICE_P)) return;
    if (B.kiai) play(pick(B.kiai[pick(lines)]), { gain: w.heavy ? 0.9 : 0.72, rate: rnd(0.97, 1.03), send: 0.2, bus: vox, prio: 1, delay: kiaiDelay });
  }
  function frame() {
    requestAnimationFrame(frame);
    const now = performance.now(), dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    if (!ok()) return;
    musouFrame();
    const h = game.hero, m = h.state === 'attack' && h.move && MOVES[h.move];
    if (m) {
      if (h.moveSeq !== seq) { seq = h.moveSeq; seenT = -1; }   // missed attack:start (should not happen)
      for (let t = seenT + 1; t <= h.moveT; t++) cue(m, t);
      seenT = Math.max(seenT, h.moveT);
    }
    // bed follows combat intensity (hits per ~2 s)
    intensity *= Math.exp(-dt / 2);
    const b = 1 - Math.exp(-intensity / 60), t = ctx.currentTime;   // ≈0.35 for a light skirmish, ≈0.8 in a packed melee
    if (bedG) {
      bedG.gain.setTargetAtTime(BED[0] + BED[1] * b, t, 0.3); drumG.gain.setTargetAtTime(DRUMS[0] + DRUMS[1] * b, t, 0.6);
      musicG.gain.setTargetAtTime(MUSIC[0] + MUSIC[1] * b, t, 0.8);
    }
    // foreground army shouts around the hero, denser as the fight heats up (the bed carries the distant ones)
    if (B.crowd && now > nextShout) {
      nextShout = now + rnd(1000, 3000) / (0.5 + b);
      play(pick(B.crowd), { gain: rnd(0.14, 0.24) * (0.6 + 0.6 * b), rate: rnd(0.9, 1.1), pan: rnd(-0.8, 0.8), send: 0.35, bus: vox });
    }
  }
  requestAnimationFrame(frame);
  on('attack:start', (e) => {                 // fires inside the sim step: frame-0 cues play without the rAF poll's lag
    const h = game.hero, m = MOVES[e.move];
    seq = h.moveSeq; seenT = 0;
    if (ok() && m) cue(m, 0);
  });

  // ---- impacts
  on('hits', (e) => {
    if (!ok()) return;
    const n = e.count, { pan, att } = place(e.x, e.z);
    intensity += e.move === 'musou' ? n * 0.15 : n;   // the field a Musou clears goes quiet after it (no bed swell)
    if (e.move === 'musou') {                   // flurry: every tick frame is voiced — an accented stab ≥ 70 ms apart
      if (game.frame === muFrame) return;       // (≈ 14/s) on a dipped floor, a short sharp strike on the ticks between
      muFrame = game.frame;
      const u = mu ? clamp((game.musou.t - mu.C) / (mu.F - mu.C), 0, 1) : 1, cr = 0.7 + 0.45 * u;   // builds to the burst
      if (!gate('muHit', 70)) {
        play(pick(B.hit), { gain: rnd(0.4, 0.5) * cr, rate: rnd(1.25, 1.5), pan: pan * 0.6 + rnd(-0.3, 0.3), send: 0.03 });
        return;
      }
      side(n, true, 0.05);
      play(pick(B.hit), { gain: 0.9 * cr, rate: rnd(1.05, 1.25), pan: pan * 0.6, send: 0.08, prio: 1 });
      if (n >= 4) play(pick(B.mass), { gain: 0.5 * cr, rate: rnd(1, 1.2), pan: pan * 0.6, send: 0.06 });
      return;
    }
    // multi-tick window (C2-C4, C6 flurries): where this tick sits in its train. The next tick comes every + hitstop
    // frames later; the last one of a train lands hardest (a crescendo, so the spin / flurry ends on its blow)
    const h = game.hero, mv = e.move === h.move && MOVES[h.move];
    const w = mv && mv.hits.find((q) => q.every && q.every < 99 && h.moveT >= q.f[0] && h.moveT <= q.f[1]);
    const more = !!w && h.moveT + w.every <= w.f[1], fin = !!w && !more && h.moveT > w.f[0];
    // a spin train opens light (its big whoosh + kiai carry the first tick) and builds to the last blow
    const train = !w ? 1 : fin ? 1.25 : h.moveT === w.f[0] && w.shape === 'circle' ? 0.65 : 0.9;
    const k = Math.min(1.4, 0.5 + Math.log2(n + 1) * 0.2) * train;   // mass hits land harder (1 victim 0.7, 16 victims 1.3)
    side(n, false, more ? (w.every + e.hitstop) / 60 + 0.03 : 0);
    if (e.heavy) {
      play(pick(B.hitHeavy), { gain: 1.15 * k, rate: rnd(0.92, 1.06), pan: pan * 0.5, send: 0.3, prio: 1 });
      duck(0.4, 0.12 + e.hitstop / 60, 0.25);
      if (e.hitstop >= 5) play(pick(B.blow), { delay: e.hitstop / 60, gain: 0.55, pan: pan * 0.5, send: 0.2 });   // bodies fly when the freeze releases
    } else {
      play(pick(B.hit), { gain: 0.9 * k * (0.7 + 0.3 * att), rate: rnd(0.9, 1.12), pan, send: 0.12, prio: 1 });
      if (Math.random() < 0.35) play(pick(B.clank), { gain: 0.3 * k, rate: rnd(0.85, 1.2), pan: pan + rnd(-0.2, 0.2), send: 0.15 });
    }
    // multi-hit crunch: a body-cluster layer for 3+ victims, plus grains packed into ≈ 30 ms so the tick reads as one blow
    if (n >= 3 || fin) play(pick(B.mass), { gain: Math.min(0.8, 0.3 + n * 0.035) * (fin ? 1.3 : 1), rate: rnd(0.9, 1.1), pan: pan * 0.6, send: 0.1, prio: 1 });
    const g = Math.min(6, n - 1);
    for (let j = 0; j < g; j++) play(pick(B.crunch), { gain: rnd(0.25, 0.4), rate: rnd(0.8, 1.25), pan: pan + rnd(-0.45, 0.45), delay: 0.004 + j * rnd(0.003, 0.005), send: 0.06 });
  });
  on('hit', (e) => {
    if (!ok() || e.killed || e.move === 'musou' || Math.random() > 0.3 || !gate('grunt', 180)) return;
    const { pan, att } = place(e.x, e.z);
    play(pick(B.grunt), { gain: 0.3 * att, rate: rnd(0.9, 1.1), pan, delay: rnd(0.02, 0.06), send: 0.15, bus: vox });
  });
  on('ko', (e) => {
    if (!ok()) return;
    const { pan, att } = place(e.x, e.z);
    if (e.officer) { play(pick(B.officerCry), { gain: 0.6, pan, delay: 0.04, send: 0.25, bus: vox, prio: 1 }); return; }
    if (Math.random() > 0.55 || !gate('cry', 130)) return;
    play(pick(B.cry), { gain: rnd(0.3, 0.42) * att, rate: rnd(0.9, 1.1), pan, delay: rnd(0.03, 0.09), send: 0.22, bus: vox });
  });
  on('enemy:land', (e) => {
    if (!ok() || !gate('fall', e.bounce ? 110 : 80)) return;
    const { pan, att } = place(e.x, e.z);
    play(pick(B.fall), { gain: (e.bounce ? 0.18 : 0.28) * att, rate: rnd(0.85, 1.15) * (e.bounce ? 1.15 : 1), pan, send: 0.08, bus: underBus });
  });

  // ---- hero
  on('dodge', () => ok() && play(pick(B.dodge), { gain: 0.7, rate: rnd(0.95, 1.05), send: 0.1, prio: 1 }));
  on('jump', () => {
    if (!ok()) return;
    play(pick(B.dodge), { gain: 0.35, rate: rnd(1.1, 1.25) });
    if (Math.random() < 0.6) play(pick(B.hup), { gain: 0.4, bus: vox, send: 0.1 });
  });
  on('land', (e) => ok() && play(pick(B.land), { gain: e.hard ? 0.75 : 0.4, rate: rnd(0.95, 1.1), send: 0.08, prio: 1 }));
  on('hero:hurt', (e) => {
    if (!ok()) return;
    if (e.armored) { play(pick(B.clank), { gain: 0.5, rate: rnd(0.8, 1), send: 0.15 }); return; }
    play(pick(B.hit), { gain: 0.6, rate: rnd(0.75, 0.85), send: 0.1, prio: 1 });
    if (gate('hurtVox', 400)) play(pick(B.hurt), { gain: 0.6, bus: vox, delay: 0.02, send: 0.12, prio: 1 });
  });
  on('enemy:attack', (e) => {
    if (!ok() || !gate('eswing', 140)) return;
    const { pan, att } = place(e.x, e.z);
    play(pick(B.enemySwing), { gain: 0.3 * att, rate: rnd(0.85, 1.1), pan, send: 0.1, bus: underBus });
    if (e.officer || Math.random() < 0.25) play(pick(B.grunt), { gain: 0.25 * att, rate: rnd(1.05, 1.2), pan, bus: vox, send: 0.15 });
  });

  // ---- Musou
  on('musou:ready', () => ok() && play(B.ready, { gain: 0.5, send: 0.3, prio: 1 }));
  function undip() {                           // restore the mix and the sfx / voice buses after the Musou
    for (const [bus, v] of [[sfx, 1], [vox, VOX], [post, POST]]) ramp(bus.gain, [[0.004, v]]);
  }
  function stopDrone(fade = 0) {               // fade: drone + riser out over ≈ fade s (the contact blast covers it)
    if (!drone) return;
    const t = ctx.currentTime;
    if (fade && mu && mu.g) for (const p of [mu.g.g, mu.g.rg]) { p.cancelScheduledValues(t); p.setTargetAtTime(0, t, fade / 3); }
    for (const n of drone) n.stop(t + fade);
    drone = null;
  }
  // Shape (DW8XL ground Musou): flash + shout → hushed close-up (bed and buses dip, low drone) → drone + riser swell over
  // the chase run → CONTACT impact restores the mix → stab flurry → short inhale (triggered by the flurry's own ticks,
  // so sim lag can't misplace it) → burst.
  function ramp(g, pts) {                      // [[dt, v], ...] linear segments from now
    const t = ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
    for (const [dt, v] of pts) g.linearRampToValueAtTime(v, t + dt);
  }
  on('musou:start', (e) => {
    if (!ok()) return;
    mu = { A: e.activation, C: e.contact, F: e.burstAt, inhaled: false, hushed: false, spins: 0, g: null };
    play(B.flash, { gain: 0.8, send: 0.4, prio: 1 });
    play(B.musouKiai, { gain: 1.0, delay: 0.06, bus: vox, send: 0.3, prio: 1 });
    ramp(bedDuck.gain, [[0.02, 0.3]]);          // bed deep under the activation (the close-up hush takes it lower)
    // charge drone: detuned saws through an opening lowpass with a tremolo, plus a noise riser into the contact. Its
    // levels follow the sim's Musou clock every frame (musouFrame), so a slow real-time sim can't misplace the swell.
    stopDrone();
    const t = ctx.currentTime, g = ctx.createGain(), lp = ctx.createBiquadFilter(), trem = ctx.createGain();
    g.gain.value = 0; lp.type = 'lowpass'; lp.Q.value = 3; lp.frequency.value = 200; trem.gain.value = 0.7;
    const nodes = [55, 55.4, 82.6, 110.3].map((f) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); return o; });
    const lfo = ctx.createOscillator(); lfo.frequency.value = 6;
    const lg = ctx.createGain(); lg.gain.value = 0.3; lfo.connect(lg).connect(trem.gain);
    lp.connect(trem).connect(g).connect(mix); g.connect(revIn);
    const rbp = ctx.createBiquadFilter(); rbp.type = 'bandpass'; rbp.Q.value = 1.5; rbp.frequency.value = 400;
    const rg = ctx.createGain(); rg.gain.value = 0;
    const rn = ctx.createBufferSource(); rn.buffer = noiseBuf(); rn.loop = true;
    rn.connect(rbp).connect(rg).connect(ceiling);
    for (const n of [...nodes, lfo, rn]) n.start(t);
    drone = [...nodes, lfo, rn];
    mu.g = { g: g.gain, lp: lp.frequency, lfo: lfo.frequency, rg: rg.gain, rbp: rbp.frequency };
  });
  /** Per-frame Musou shaping from the sim's Musou clock (read-only): close-up hush, charge swell, finisher wind-up. */
  function musouFrame() {
    const M = game.musou;
    if (!mu || !M.active) return;
    const t = M.t, now = ctx.currentTime, set = (p, v, tau = 0.03) => p.setTargetAtTime(v, now, tau);
    if (!mu.hushed && t >= mu.A) {             // close-up: the world is paused — bed near silent, buses dip, drone hums
      mu.hushed = true;
      ramp(bedDuck.gain, [[0.35, 0.07]]);
      for (const bus of [sfx, vox]) ramp(bus.gain, [[0.3, (bus === vox ? VOX : 1) * 0.3]]);
    }
    if (drone && mu.g && t < mu.C) {           // hum → swell over the last ≈0.55 s of the chase run into the contact
      const u = Math.max(0, (t - (mu.C - 33)) / 33), q = u * u;
      set(mu.g.g, t < mu.A ? 0.015 * t / mu.A : 0.018 + 0.13 * q);
      set(mu.g.lp, t < mu.A ? 200 + 500 * t / mu.A : 1100 * (5000 / 1100) ** u);
      set(mu.g.lfo, 6 + 12 * t / mu.C, 0.1);
      set(mu.g.rg, 0.3 * q); set(mu.g.rbp, 400 * (7000 / 400) ** u);
    }
    // finisher wind-up: two spins ≈0.46 s and ≈0.24 s before the burst
    for (const [k, df, gv] of [[0, 28, 0.55], [1, 14, 0.7]]) {
      if (mu.spins === k && t >= mu.F - df) { mu.spins++; play(pick(B.spin), { gain: gv, rate: rnd(0.88, 0.96), send: 0.25, bus: underBus, prio: 1 }); }
    }
  }
  on('musou:hit', (e) => {
    if (!ok()) return;
    if (e.stage === 'contact') {               // first mass hit: the mix comes back with a blast
      stopDrone(0.06);
      for (const bus of [sfx, vox]) ramp(bus.gain, [[0.004, bus === vox ? VOX : 1]]);
      ramp(bedDuck.gain, [[0.01, 0.2], [0.4, 0.3]]);   // the flurry owns the mix until the burst
      play(pick(B.hitHeavy), { gain: 1.0, rate: rnd(0.95, 1.02), send: 0.3, prio: 1 });
      play(pick(B.blow), { gain: 0.6, delay: 0.05, send: 0.25, prio: 1 });
      if (B.kiai) play(pick(B.kiai.hyah), { gain: 0.85, bus: vox, send: 0.25, prio: 1 });
      return;
    }
    if (e.stage === 'rush' && gate('muSwing', 130)) play(pick(B.thrust), { gain: 0.16, rate: rnd(1.0, 1.15), pan: rnd(-0.2, 0.2), send: 0.1, bus: underBus, prio: 1 });
    if (mu && !mu.inhaled && e.stage !== 'wave' && e.n >= mu.F - mu.C - 9) {   // ≈ 0.15 s before the burst
      mu.inhaled = true;
      ramp(post.gain, [[0.1, POST * 0.2], [0.4, POST * 0.2], [0.45, POST]]);   // the burst event restores it earlier
    }
    if (B.kiai && e.stage === 'rush' && gate('muKiai', 280)) play(pick(B.kiai[Math.random() < 0.5 ? 'ha' : 'tah']), { gain: 0.55, rate: rnd(1.0, 1.08), bus: vox, send: 0.2 });
  });
  on('musou:burst', (e) => {
    if (!ok()) return;
    stopDrone(); undip();
    play(B.boom, { gain: 1.2, send: 0.45, prio: 1 });
    if (B.kiai) play(pick(B.kiai.seiya), { gain: 0.8, bus: vox, send: 0.35, prio: 1 });
    if (e.count > 3) play(B.screams, { gain: 0.55, delay: 0.1, bus: vox, send: 0.3, prio: 1 });
    duck(0.35, 0.6, 0.6);
  });
  on('crowd:wave', (e) => {
    if (!ok()) return;
    const { pan } = place(e.x, e.z);
    play(B.horn, { gain: 0.32, pan: pan * 0.6, send: 0.45 });
    play(B.roar, { gain: 0.4, pan: pan * 0.5, delay: 0.6, bus: vox, send: 0.4 });
  });
  on('scenario', () => { if (ctx) { stopDrone(); undip(); } intensity = 0; seq = -1; mu = null; muFrame = -1; });
}
