// Offline-synthesised sound bank (OfflineAudioContext, no downloads). Everything is baked once at boot into AudioBuffers
// — formant-synth voices (Zhao Yun kiai, enemy grunts / death cries, distant army), layered spear whooshes, slash
// impacts, armour clanks, body falls, Musou stingers, a looping battle bed, a war-drum loop and a power-chord riff loop
// (bake ≈ 0.9 s at boot; combat sounds are ready after ≈ 0.1 s) — and played back by
// audio.js with random rate / gain / pan, so 50+ hits per second stay cheap and never repeat back to back.
// Audio variation uses Math.random: it must never touch the sim or visual RNG.
const SR = 48000;
const rnd = (a, b) => a + (b - a) * Math.random();
const pick = (a) => a[Math.floor(Math.random() * a.length)];

let NOISE = null;
export function noiseBuf() {
  if (!NOISE) {
    NOISE = new AudioBuffer({ length: SR * 3, sampleRate: SR, numberOfChannels: 1 });
    const d = NOISE.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return NOISE;
}

/** Stereo reverb impulse for the runtime convolver: 1.5 s of decaying noise that darkens over time. */
export function makeIR() {
  const sec = 1.5, decay = 3.4, n = Math.floor(sec * SR), b = new AudioBuffer({ length: n, sampleRate: SR, numberOfChannels: 2 });
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const u = i / n, a = 0.75 - 0.6 * u;                 // one-pole lowpass closing over the tail
      lp += a * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * Math.exp(-decay * u * sec) * (i < SR * 0.012 ? i / (SR * 0.012) : 1);
    }
  }
  return b;
}

// ---- node helpers (all take the offline context)
function pts(p, t0, a, exp) {
  p.setValueAtTime(a[0][1], t0 + a[0][0]);
  for (let i = 1; i < a.length; i++) {
    if (exp) p.exponentialRampToValueAtTime(Math.max(1e-4, a[i][1]), t0 + a[i][0]);
    else p.linearRampToValueAtTime(a[i][1], t0 + a[i][0]);
  }
}
function nz(oc, t, dur, rate = 1) {
  const s = oc.createBufferSource(); s.buffer = noiseBuf(); s.loop = true; s.playbackRate.value = rate;
  s.start(t, rnd(0, 2.5)); s.stop(t + dur); return s;
}
function osc(oc, type, t, dur, f) {
  const o = oc.createOscillator(); o.type = type; if (f) o.frequency.value = f;
  o.start(t); o.stop(t + dur); return o;
}
function filt(oc, type, f, q = 0.707) { const b = oc.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
function gain(oc, v) { const g = oc.createGain(); g.gain.value = v; return g; }
function env(oc, t0, a) { const g = oc.createGain(); g.gain.value = 0; pts(g.gain, t0, a); return g; }
/** Percussive envelope: linear attack, exponential-ish decay (time constant dec/4). */
function perc(oc, t, a, dec, peak = 1) {
  const g = oc.createGain(); g.gain.value = 0;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setTargetAtTime(0, t + a, dec / 4);
  return g;
}
function curve(oc, t, dur, fn) {                 // gain following fn(u), u ∈ [0,1]
  const g = oc.createGain(), c = new Float32Array(256);
  for (let i = 0; i < 256; i++) c[i] = fn(i / 255);
  g.gain.setValueCurveAtTime(c, t, dur); return g;
}
function shaper(oc, drive) {
  const w = oc.createWaveShaper(), c = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; c[i] = Math.tanh(x * drive) / Math.tanh(drive); }
  w.curve = c; return w;
}
function pan(oc, p) { const s = oc.createStereoPanner(); s.pan.value = p; return s; }
function smp(oc, dst, buf, t, rate, g, p) {             // place a baked buffer inside another bake
  const s = oc.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
  s.connect(gain(oc, g)).connect(pan(oc, p)).connect(dst); s.start(t);
}

async function bake(dur, fn, ch = 1, peak = 0.9, trim = true, sr = SR) {
  const oc = new OfflineAudioContext(ch, Math.ceil(dur * sr), sr);
  fn(oc, oc.destination);
  const b = await oc.startRendering();
  let m = 0;
  for (let c = 0; c < ch; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i])); }
  const k = m > 0 ? peak / m : 1, fade = Math.floor(sr * 0.006);
  let last = 0;                                              // trim trailing silence (< -66 dBFS)
  if (!trim) last = b.length - 1;
  else for (let c = 0; c < ch; c++) { const d = b.getChannelData(c); for (let i = d.length - 1; i > last; i--) if (Math.abs(d[i]) * k > 5e-4) { last = i; break; } }
  const len = Math.min(b.length, last + fade + 1), o = new AudioBuffer({ length: len, sampleRate: sr, numberOfChannels: ch });
  for (let c = 0; c < ch; c++) {
    const d = o.getChannelData(c);
    d.set(b.getChannelData(c).subarray(0, len));
    for (let i = 0; i < len; i++) d[i] *= k;
    for (let i = 0; i < fade; i++) d[len - 1 - i] *= i / fade;
  }
  return o;
}
/** Loop: render len + tail, fold the tail back onto the start (layers must cross-fade over [0,tail) / [len,len+tail)).
 *  Loops render at 24 kHz: they are dark distance layers, and it halves the boot bake. */
async function bakeLoop(len, tail, fn, peak, sr = 24000) {
  const b = await bake(len + tail, fn, 2, peak, false, sr), n = Math.floor(len * sr), out = new AudioBuffer({ length: n, sampleRate: sr, numberOfChannels: 2 });
  for (let c = 0; c < 2; c++) {
    const s = b.getChannelData(c), d = out.getChannelData(c);
    d.set(s.subarray(0, n));
    for (let i = n; i < s.length; i++) d[i - n] += s[i];
  }
  return out;
}
const xfade = (len, tail) => (oc, t0 = 0) => curve(oc, t0, len + tail, (u) => {   // equal-power in/out for folded loops
  const s = u * (len + tail);
  return s < tail ? Math.sin(Math.PI / 2 * s / tail) : s > len ? Math.cos(Math.PI / 2 * (s - len) / tail) : 1;
});

// ---- formant voice
// Male vowel formants (shouted: F1 raised). 'A' = "uh".
const VOW = { a: [820, 1220, 2700, 3500], A: [660, 1180, 2550, 3400], e: [540, 1820, 2550, 3450], i: [340, 2250, 3000, 3700],
  o: [590, 930, 2550, 3400], u: [390, 820, 2350, 3300] };
const BW = [95, 120, 170, 260], FG = [1, 0.8, 0.42, 0.22];

/**
 * o = { t, k (pitch scale), f0:[[s,hz]], vow:[[s,'a']], amp:[[s,v]], asp:[[s,v]] (attack breath), growl (0..1 sub-harmonic
 *       roughness), fric:[t, dur, gain, hpHz] (s/t/g burst), jit, gain, fk (formant scale),
 *       breath (0..1, default 0.35: aspiration riding the voiced envelope + a broadband rasp — a shout is half air) }
 */
function voice(oc, dst, o) {
  const t = o.t || 0, k = o.k || 1, fk = o.fk || 1;
  const len = o.amp[o.amp.length - 1][0] + 0.03;
  const f0 = o.f0.map(([u, f]) => [u, f * k]);
  const src = env(oc, t, o.amp);
  const g1 = osc(oc, 'sawtooth', t, len); pts(g1.frequency, t, f0, true);
  const jit = gain(oc, f0[0][1] * (o.jit ?? 0.035));
  nz(oc, t, len).connect(filt(oc, 'lowpass', 28)).connect(jit).connect(g1.frequency);
  const vib = osc(oc, 'sine', t, len, rnd(5, 7)), vg = gain(oc, f0[0][1] * 0.014);
  vib.connect(vg).connect(g1.frequency);
  g1.connect(src);
  let voiced = src;
  if (o.growl) {                                  // phase-ish locked sub-harmonic AM → strained, rough shout
    const am = gain(oc, 1 - o.growl * 0.5), m = osc(oc, 'sine', t, len), md = gain(oc, o.growl * 0.5);
    pts(m.frequency, t, f0.map(([u, f]) => [u, f * 0.5]), true);
    m.connect(md).connect(am.gain); src.connect(am); voiced = am;
  }
  const asp = env(oc, t, o.asp || [[0, 0], [0.01, 0]]);
  nz(oc, t, len).connect(asp);
  const out = gain(oc, o.gain ?? 1), br = o.breath ?? 0.35;
  const air = env(oc, t, o.amp.map(([u, v]) => [u, v * br * 2.5]));      // breath through the formants (noise is ≈ -8 dB vs saw)
  nz(oc, t, len).connect(air);
  for (let j = 0; j < 4; j++) {
    const b = filt(oc, 'bandpass', 1000, VOW[o.vow[0][1]][j] * fk / BW[j]);
    pts(b.frequency, t, o.vow.map(([u, v]) => [u, VOW[v][j] * fk]));
    const g = gain(oc, FG[j]);
    voiced.connect(b); asp.connect(b); air.connect(b); b.connect(g).connect(out);
  }
  nz(oc, t, len).connect(filt(oc, 'bandpass', 3200, 0.6)).connect(env(oc, t, o.amp.map(([u, v]) => [u, v * br * 0.22]))).connect(out);   // rasp
  voiced.connect(filt(oc, 'lowpass', 380)).connect(gain(oc, 0.35)).connect(out);   // chest / fundamental
  if (o.fric) {
    const [ft, fd, fg, ff] = o.fric;
    nz(oc, t, len).connect(filt(oc, 'highpass', ff || 3800, 0.9))
      .connect(env(oc, t, [[0, 0], [ft, 0], [ft + 0.006, fg], [ft + fd, 0]])).connect(out);
  }
  out.connect(dst);
}

// Zhao Yun's kiai lines (seconds from the cue; the vowel peak lands ≈ 50-70 ms in, on the first trail frame)
const LINES = {
  ha: { f0: [[0, 220], [0.06, 268], [0.14, 250], [0.24, 185]], vow: [[0, 'A'], [0.07, 'a'], [0.24, 'a']],
    amp: [[0, 0], [0.035, 0.08], [0.065, 1], [0.15, 0.75], [0.25, 0]], asp: [[0, 0], [0.012, 0.9], [0.05, 0.5], [0.085, 0]], growl: 0.15 },
  hah: { f0: [[0, 230], [0.07, 282], [0.18, 262], [0.3, 190]], vow: [[0, 'A'], [0.08, 'a'], [0.24, 'a'], [0.3, 'A']],
    amp: [[0, 0], [0.035, 0.1], [0.07, 1], [0.2, 0.8], [0.31, 0]], asp: [[0, 0], [0.012, 1], [0.05, 0.5], [0.09, 0]], growl: 0.25 },
  sei: { f0: [[0.05, 252], [0.1, 292], [0.24, 238]], vow: [[0.05, 'e'], [0.13, 'e'], [0.21, 'i']],
    amp: [[0, 0], [0.055, 0], [0.085, 1], [0.17, 0.8], [0.26, 0]], fric: [0, 0.07, 0.7, 4200], growl: 0.12 },
  toh: { f0: [[0.02, 245], [0.06, 278], [0.21, 200]], vow: [[0.02, 'o'], [0.21, 'o']],
    amp: [[0, 0], [0.022, 0], [0.042, 1], [0.14, 0.7], [0.22, 0]], fric: [0, 0.022, 1, 2400], growl: 0.18 },
  tah: { f0: [[0.02, 255], [0.06, 290], [0.2, 215]], vow: [[0.02, 'a'], [0.2, 'A']],
    amp: [[0, 0], [0.022, 0], [0.042, 1], [0.13, 0.75], [0.21, 0]], fric: [0, 0.02, 1, 2600], growl: 0.15 },
  hyah: { f0: [[0, 240], [0.08, 305], [0.18, 275], [0.3, 200]], vow: [[0, 'i'], [0.05, 'i'], [0.11, 'a'], [0.3, 'a']],
    amp: [[0, 0], [0.03, 0.2], [0.06, 1], [0.2, 0.8], [0.31, 0]], asp: [[0, 0], [0.01, 0.8], [0.04, 0.3], [0.07, 0]], growl: 0.2 },
  seiya: { f0: [[0.06, 250], [0.12, 288], [0.19, 250], [0.23, 272], [0.32, 335], [0.46, 305], [0.62, 205]],
    vow: [[0.06, 'e'], [0.15, 'i'], [0.22, 'i'], [0.29, 'a'], [0.62, 'a']],
    amp: [[0, 0], [0.06, 0], [0.085, 0.9], [0.18, 0.7], [0.205, 0.3], [0.25, 1], [0.46, 0.85], [0.63, 0]], fric: [0, 0.065, 0.7, 4200], growl: 0.3 },
  uora: { f0: [[0, 200], [0.1, 252], [0.3, 282], [0.4, 318], [0.72, 220]], vow: [[0, 'u'], [0.1, 'o'], [0.3, 'o'], [0.37, 'a'], [0.72, 'a']],
    amp: [[0, 0], [0.05, 0.8], [0.3, 0.9], [0.335, 0.45], [0.38, 1], [0.6, 0.8], [0.73, 0]], growl: 0.3 },
  haa: { f0: [[0, 232], [0.08, 292], [0.4, 312], [0.62, 228]], vow: [[0, 'A'], [0.08, 'a'], [0.62, 'a']],
    amp: [[0, 0], [0.04, 0.12], [0.08, 1], [0.45, 0.85], [0.63, 0]], asp: [[0, 0], [0.012, 0.9], [0.06, 0.4], [0.1, 0]], growl: 0.3 },
};
const HERO_EXTRA = {
  musou: { f0: [[0, 205], [0.12, 262], [0.6, 300], [0.95, 338], [1.2, 250]], vow: [[0, 'A'], [0.12, 'a'], [1.2, 'a']],
    amp: [[0, 0], [0.05, 0.15], [0.14, 0.9], [0.8, 1], [1.05, 0.8], [1.22, 0]], asp: [[0, 0], [0.015, 0.9], [0.08, 0.4], [0.14, 0]], growl: 0.4 },
  hurt: { f0: [[0, 205], [0.04, 215], [0.2, 140]], vow: [[0, 'A'], [0.1, 'u']], amp: [[0, 0], [0.018, 1], [0.1, 0.6], [0.21, 0]],
    fric: [0, 0.018, 0.9, 1400], growl: 0.45 },
  hup: { f0: [[0, 228], [0.06, 250], [0.1, 235]], vow: [[0, 'A']], amp: [[0, 0], [0.02, 0.8], [0.08, 0.8], [0.11, 0]],
    asp: [[0, 0], [0.01, 0.8], [0.03, 0]], growl: 0.1 },
};

function grunt(oc, dst) {
  const b = rnd(118, 168), d = rnd(0.12, 0.22), v = pick(['A', 'u', 'o', 'a']);
  voice(oc, dst, { f0: [[0, b], [0.03, b * 1.12], [d, b * 0.72]], vow: [[0, v], [d, v]],
    amp: [[0, 0], [0.018, 1], [d * 0.6, 0.6], [d, 0]], fric: Math.random() < 0.5 ? [0, 0.016, 0.8, 1300] : null,
    asp: [[0, 0], [0.01, 0.6], [0.03, 0]], growl: rnd(0.3, 0.6), fk: rnd(0.9, 1.0) });
}
function cry(oc, dst, t = 0, b = rnd(135, 215), gainV = 1) {
  const d = rnd(0.38, 0.7), seq = pick([['u', 'a', 'a'], ['a', 'a', 'o'], ['A', 'a', 'A'], ['o', 'a', 'a'], ['i', 'a', 'A']]);
  voice(oc, dst, { t, gain: gainV, f0: [[0, b], [0.07, b * 1.28], [0.2, b * 1.18], [d, b * 0.62]],
    vow: [[0, seq[0]], [0.08, seq[1]], [d, seq[2]]], amp: [[0, 0], [0.03, 0.9], [0.1, 1], [d * 0.7, 0.7], [d, 0]],
    fric: Math.random() < 0.5 ? [0, 0.02, 0.8, 1500] : null, asp: [[0, 0], [0.012, 0.5], [0.04, 0]], growl: rnd(0.35, 0.65),
    jit: 0.05, fk: rnd(0.88, 1.02) });
}
function crowdVoice(oc, dst, t, b = rnd(140, 260), d = rnd(0.5, 1.4)) {
  const v = pick(['a', 'o', 'A', 'a', 'e']);
  voice(oc, dst, { t, f0: [[0, b * 0.9], [0.15, b * 1.1], [d * 0.7, b * 1.05], [d, b * 0.8]],
    vow: [[0, pick(['u', 'o', 'A'])], [0.14, v], [d, v]], amp: [[0, 0], [0.12, 1], [d * 0.75, 0.85], [d, 0]],
    growl: rnd(0.2, 0.5), jit: 0.05, fk: rnd(0.9, 1.05) });
}

// ---- whooshes: body band sweep + high "tear" + narrow spear whistle (+ sub for heavy)
function whoosh(oc, dst, { dur, lo, hi, pk, q, tear, whistle, sub = 0, pulses = 0 }) {
  const shape = (u) => {
    let e = u < pk ? (u / pk) ** 1.3 : (1 - (u - pk) / (1 - pk)) ** 1.7;   // quick rise: the whoosh reads from its first frames
    if (pulses) e *= 0.3 + 0.7 * Math.sin(Math.PI * u * pulses) ** 2;
    return e;
  };
  const sw = [[0, lo], [dur * pk, hi], [dur, lo * 1.25]];
  const b = filt(oc, 'bandpass', lo, q); pts(b.frequency, 0, sw, true);
  nz(oc, 0, dur).connect(b).connect(curve(oc, 0, dur, shape)).connect(dst);
  if (tear) nz(oc, 0, dur).connect(filt(oc, 'highpass', 3600)).connect(curve(oc, 0, dur, (u) => shape(u) ** 3 * tear)).connect(dst);
  if (whistle) {
    const w = filt(oc, 'bandpass', lo * 2, 16); pts(w.frequency, 0, sw.map(([u, f]) => [u, f * 1.9]), true);
    nz(oc, 0, dur).connect(w).connect(curve(oc, 0, dur, (u) => shape(u) * whistle * 4)).connect(dst);
  }
  if (sub) {
    const s = osc(oc, 'sine', 0, dur); pts(s.frequency, 0, [[0, 120], [dur, 52]], true);
    s.connect(curve(oc, 0, dur, (u) => shape(u) * sub)).connect(dst);
  }
}

// ---- impacts
function clank(oc, dst, t = 0, base = rnd(700, 1500), g = 1, dec = rnd(0.12, 0.3)) {
  [1, 2.76, 5.4, 8.93].forEach((r, j) => {
    if (base * r > 18000) return;
    osc(oc, 'sine', t, dec * 2, base * r * rnd(0.985, 1.015)).connect(perc(oc, t, 0.001, dec / (1 + j * 0.6), g / (1 + j * 0.8))).connect(dst);
  });
  nz(oc, t, 0.01).connect(filt(oc, 'highpass', 3000)).connect(perc(oc, t, 0.0005, 0.008, g * 0.6)).connect(dst);
}
function grains(oc, dst, t, span, n, lp, g) {
  for (let i = 0; i < n; i++) {
    const ti = t + Math.random() * span;
    nz(oc, ti, 0.03).connect(filt(oc, 'bandpass', rnd(600, lp), 1.2)).connect(perc(oc, ti, 0.0008, rnd(0.008, 0.025), g * rnd(0.5, 1))).connect(dst);
  }
}
function impact(oc, dst, { heavy = false, metal = 0 }) {
  const T = heavy ? 1.0 : 0.4;
  nz(oc, 0, 0.012).connect(filt(oc, 'highpass', 1800)).connect(perc(oc, 0, 0.0005, 0.007, 1)).connect(dst);            // click
  nz(oc, 0, 0.15).connect(filt(oc, 'bandpass', rnd(2400, 4300), 0.9)).connect(perc(oc, 0, 0.001, rnd(0.045, 0.08), 0.8)).connect(dst);  // slash crack
  const sl = filt(oc, 'bandpass', 6500, 1.6); pts(sl.frequency, 0, [[0, rnd(5500, 7500)], [0.07, rnd(1800, 2600)]], true);  // blade "shk": falling slice
  nz(oc, 0, 0.12).connect(sl).connect(perc(oc, 0, 0.0015, rnd(0.06, 0.09), heavy ? 0.9 : 1.1)).connect(dst);
  const t2 = rnd(0.008, 0.016);                                                                                      // armour crunch, second transient
  nz(oc, t2, 0.08).connect(filt(oc, 'bandpass', rnd(1200, 1900), 1.1)).connect(perc(oc, t2, 0.001, rnd(0.03, 0.05), 0.75)).connect(dst);
  const b = osc(oc, 'sine', 0, T);                                                                                    // body thump
  pts(b.frequency, 0, [[0, heavy ? rnd(115, 135) : rnd(150, 195)], [heavy ? 0.28 : 0.1, heavy ? 36 : 56]], true);
  b.connect(perc(oc, 0, 0.002, heavy ? 0.5 : 0.11, 1)).connect(shaper(oc, heavy ? 3.5 : 1.8)).connect(gain(oc, heavy ? 1.0 : 0.6)).connect(dst);   // light: tight, so flurry ticks separate
  nz(oc, 0, 0.12).connect(filt(oc, 'bandpass', rnd(420, 680), 1.3)).connect(perc(oc, 0.001, 0.002, heavy ? 0.09 : 0.05, heavy ? 1.1 : 0.9)).connect(dst);   // "thwack": low-mid body (the 500 Hz octave was a hole)
  nz(oc, 0, 0.2).connect(filt(oc, 'lowpass', heavy ? 900 : 1300)).connect(perc(oc, 0, 0.002, heavy ? 0.16 : 0.08, 0.9)).connect(dst);  // flesh/cloth punch
  grains(oc, dst, 0.004, heavy ? 0.12 : 0.06, heavy ? 12 : 6, heavy ? 2600 : 3400, 0.7);                          // crunch
  if (metal) clank(oc, dst, 0.002, rnd(800, 1500), metal * 0.5);
  if (heavy) {
    const s = osc(oc, 'sine', 0, T); pts(s.frequency, 0, [[0, 70], [0.6, 30]], true);
    s.connect(perc(oc, 0.005, 0.004, 0.7, 0.9)).connect(dst);
    nz(oc, 0, 0.8).connect(filt(oc, 'bandpass', 380, 0.8)).connect(perc(oc, 0.01, 0.005, 0.35, 0.5)).connect(dst);
  }
}
function crunch(oc, dst) {                                   // small extra-victim grain for mass hits
  nz(oc, 0, 0.01).connect(filt(oc, 'highpass', 2000)).connect(perc(oc, 0, 0.0005, 0.006, 0.8)).connect(dst);
  const b = osc(oc, 'sine', 0, 0.12); pts(b.frequency, 0, [[0, rnd(190, 260)], [0.06, 75]], true);
  b.connect(perc(oc, 0, 0.001, 0.06, 0.8)).connect(shaper(oc, 2)).connect(dst);
  grains(oc, dst, 0.002, 0.04, 4, 3200, 0.8);
}
function mass(oc, dst) {                                    // many bodies struck at once: a tight cluster of cracks + one fat thump
  for (let i = 0; i < 5; i++) {
    const t = i ? rnd(0.004, 0.03) : 0;
    nz(oc, t, 0.06).connect(filt(oc, 'bandpass', rnd(1300, 3800), 1.1)).connect(perc(oc, t, 0.0008, rnd(0.02, 0.045), i ? rnd(0.4, 0.75) : 1))
      .connect(pan(oc, i ? rnd(-0.6, 0.6) : 0)).connect(dst);
  }
  const b = osc(oc, 'sine', 0, 0.22); pts(b.frequency, 0, [[0, rnd(105, 140)], [0.09, 46]], true);
  b.connect(perc(oc, 0, 0.002, 0.13, 1)).connect(shaper(oc, 3)).connect(gain(oc, 0.8)).connect(dst);
  nz(oc, 0, 0.12).connect(filt(oc, 'lowpass', 1200)).connect(perc(oc, 0, 0.002, 0.07, 0.8)).connect(dst);
  nz(oc, 0, 0.1).connect(filt(oc, 'bandpass', rnd(380, 620), 1.2)).connect(perc(oc, 0.002, 0.002, 0.06, 0.9)).connect(dst);
  grains(oc, dst, 0.008, 0.05, 6, 3000, 0.45);
}
function fall(oc, dst, heavy) {                               // body hits the ground: thump + dirt + armour rattle
  const b = osc(oc, 'sine', 0, 0.3); pts(b.frequency, 0, [[0, heavy ? 95 : 120], [0.12, 42]], true);
  b.connect(perc(oc, 0, 0.002, 0.15, 1)).connect(shaper(oc, 2)).connect(dst);
  nz(oc, 0, 0.25).connect(filt(oc, 'lowpass', 900)).connect(perc(oc, 0, 0.002, 0.12, 0.8)).connect(dst);
  grains(oc, dst, 0.01, 0.12, 6, 4500, 0.35);
  if (Math.random() < 0.6) clank(oc, dst, rnd(0.01, 0.05), rnd(1100, 2000), 0.25, 0.08);
}

// ---- stingers
function bell(oc, dst, t, f, g, dec) {
  [1, 2.0, 2.76, 3.9, 5.4].forEach((r, j) => osc(oc, 'sine', t, dec * 2, f * r).connect(perc(oc, t, 0.002, dec / (1 + j * 0.5), g / (1 + j * 0.9))).connect(dst));
}
/** Energy sparkle: a short inharmonic ring (≤ 0.4 s, so it never sits as a tone) plus scattered bright noise glints that thin out. */
function shimmer(oc, dst, t, n, lo, hi, g, dec) {
  for (let i = 0; i < 5; i++) {
    const f = lo * (hi / lo) ** Math.random();
    osc(oc, 'sine', t, 0.5, f).connect(perc(oc, t, 0.002, rnd(0.2, 0.4), g / 5)).connect(pan(oc, rnd(-0.6, 0.6))).connect(dst);
  }
  for (let i = 0; i < n * 3; i++) {
    const ti = t + dec * Math.random() ** 1.8;
    nz(oc, ti, 0.04).connect(filt(oc, 'bandpass', rnd(lo * 2, hi), 4)).connect(perc(oc, ti, 0.001, rnd(0.015, 0.04), g * rnd(0.3, 0.8)))
      .connect(pan(oc, rnd(-0.8, 0.8))).connect(dst);
  }
}
function taiko(oc, dst, t, g = 1, low = 1) {
  const b = osc(oc, 'sine', t, 1.2); pts(b.frequency, t, [[0, 98 * low], [0.05, 62 * low], [0.6, 52 * low]], true);
  b.connect(perc(oc, t, 0.002, 0.55, g)).connect(shaper(oc, 1.8)).connect(dst);
  nz(oc, t, 0.1).connect(filt(oc, 'lowpass', 520)).connect(perc(oc, t, 0.001, 0.05, g * 0.8)).connect(dst);
  nz(oc, t, 0.01).connect(filt(oc, 'highpass', 2400)).connect(perc(oc, t, 0.0005, 0.006, g * 0.3)).connect(dst);
}
function rim(oc, dst, t, g) {
  osc(oc, 'sine', t, 0.08, rnd(1700, 1900)).connect(perc(oc, t, 0.0005, 0.03, g * 0.5)).connect(dst);
  nz(oc, t, 0.03).connect(filt(oc, 'bandpass', 2600, 5)).connect(perc(oc, t, 0.0005, 0.02, g)).connect(dst);
}

// ---- battle music: double-tracked distorted power chords + bass, locked to the war-drum loop (120 BPM, D minor)
function chord(oc, dst, t, root, len, mute, g, det) {
  const pre = gain(oc, 0.3);
  for (const [r, c] of [[1, 0], [1.4983, 4], [2, -5]]) {          // root, fifth, octave (amp-style intermodulation below)
    const o = osc(oc, 'sawtooth', t, len + 0.4, root * r); o.detune.value = c + det; o.connect(pre);
  }
  const hp = filt(oc, 'highpass', 120, 0.7), mid = filt(oc, 'peaking', 1500, 0.8), lp = filt(oc, 'lowpass', mute ? 1300 : 4000, 0.8);
  mid.gain.value = 4;
  pre.connect(shaper(oc, 10)).connect(hp).connect(mid).connect(lp).connect(perc(oc, t, 0.003, mute ? 0.16 : len * 1.6, g)).connect(dst);
}
function riff(oc, dst) {
  // 8 bars of eighths (0.25 s): 'O' open chord, 'x' palm-muted chug, '.' rest; one root per bar (guitar D3 = 146.8 Hz)
  const bars = [['D', 'O.xxO.xx'], ['D', 'O.xxOxOx'], ['A#', 'O.xxO.xx'], ['C', 'O.xxOOxx'],
    ['D', 'O.xxO.xx'], ['F', 'O.xxO.xx'], ['G', 'O.xxOxOx'], ['A', 'O.O.OOOO']];
  const HZ = { D: 146.83, F: 174.61, G: 196.0, A: 220.0, 'A#': 116.54, C: 130.81 };
  const L = pan(oc, -0.75), R = pan(oc, 0.75); L.connect(dst); R.connect(dst);
  const bass = filt(oc, 'lowpass', 420, 1.1); bass.connect(dst);
  bars.forEach(([n, pat], bi) => [...pat].forEach((c, i) => {
    if (c === '.') return;
    const t = bi * 2 + i * 0.25, f = HZ[n], open = c === 'O';
    const len = open && pat[i + 1] === '.' ? 0.45 : 0.22;
    chord(oc, L, t, f, len, !open, open ? 0.5 : 0.36, -6);
    chord(oc, R, t + rnd(0.006, 0.014), f * 1.002, len, !open, open ? 0.5 : 0.36, 7);
    const b = osc(oc, 'sawtooth', t, len + 0.1, f / 2), s = osc(oc, 'sine', t, len + 0.1, f / 4);
    const bg = perc(oc, t, 0.004, open ? 0.35 : 0.2, 0.55); b.connect(bg); s.connect(bg); bg.connect(bass);
  }));
}

/** Bake the bank into B progressively (combat sounds first, loops last): B.name = AudioBuffer | AudioBuffer[]. */
export async function buildBank(B = {}) {
  const n = (k, f) => Promise.all(Array.from({ length: k }, f));
  const vox = (spec, k) => bake(spec.amp.at(-1)[0] + 0.1, (oc, d) => voice(oc, d, { ...spec, k }));
  // combat-critical first
  const put = (keys, ps) => Promise.all(ps).then((v) => keys.forEach((k, i) => { B[k] = v[i]; }));
  await put(['slash', 'thrust', 'spin', 'heavy', 'hit', 'hitHeavy', 'crunch', 'clank', 'crowd', 'mass'], [
    n(6, () => bake(0.3, (oc, d) => whoosh(oc, d, { dur: rnd(0.2, 0.27), lo: rnd(420, 560), hi: rnd(2000, 2800), pk: rnd(0.4, 0.5), q: 1.3, tear: 0.45, whistle: rnd(0.15, 0.3) }))),
    n(6, () => bake(0.2, (oc, d) => whoosh(oc, d, { dur: rnd(0.12, 0.16), lo: rnd(800, 1000), hi: rnd(3400, 4400), pk: 0.35, q: 1.1, tear: 0.8, whistle: rnd(0.2, 0.35) }))),
    n(4, () => bake(0.5, (oc, d) => whoosh(oc, d, { dur: rnd(0.38, 0.46), lo: rnd(320, 420), hi: rnd(1700, 2200), pk: 0.5, q: 1.4, tear: 0.35, whistle: 0.25, pulses: 2 }))),
    n(4, () => bake(0.5, (oc, d) => whoosh(oc, d, { dur: rnd(0.36, 0.44), lo: rnd(230, 290), hi: rnd(1400, 1800), pk: 0.5, q: 1.2, tear: 0.35, whistle: 0.15, sub: 0.9 }))),
    n(14, (_, i) => bake(0.45, (oc, d) => impact(oc, d, { metal: i % 3 === 0 ? 1 : 0 }))),
    n(5, () => bake(1.1, (oc, d) => impact(oc, d, { heavy: true, metal: Math.random() < 0.5 ? 1 : 0 }))),
    n(8, () => bake(0.14, (oc, d) => crunch(oc, d))),
    n(6, () => bake(0.4, (oc, d) => clank(oc, d, 0, rnd(650, 1500), 1, rnd(0.12, 0.3)))),
    n(12, () => bake(1.5, (oc, d) => crowdVoice(oc, d, 0, rnd(130, 270), rnd(0.4, 1.3)))),
    n(6, () => bake(0.3, (oc, d) => mass(oc, d), 2)),
  ]);
  const loops = bakeLoops(B);                                 // the loops only need crowd + clank: render them alongside the rest
  const kiai = await Promise.all(Object.entries(LINES).flatMap(([id, s]) => [0.95, 1.05].map(async (k) => [id, await vox(s, k * rnd(0.97, 1.03))])));
  const K = {};
  for (const [id, b] of kiai) (K[id] = K[id] || []).push(b);
  B.kiai = K;
  await put(['grunt', 'cry', 'officerCry', 'fall', 'blow', 'enemySwing', 'dodge'], [
    n(8, () => bake(0.3, (oc, d) => grunt(oc, d))),
    n(10, () => bake(0.8, (oc, d) => cry(oc, d))),
    n(3, () => bake(0.8, (oc, d) => cry(oc, d, 0, rnd(95, 120)))),
    n(5, (_, i) => bake(0.35, (oc, d) => fall(oc, d, i < 2))),
    n(3, () => bake(0.6, (oc, d) => whoosh(oc, d, { dur: 0.5, lo: 180, hi: 900, pk: 0.18, q: 0.9, tear: 0.2, whistle: 0, sub: 0.7 }))),
    n(3, () => bake(0.25, (oc, d) => whoosh(oc, d, { dur: 0.2, lo: 600, hi: 2000, pk: 0.45, q: 1.2, tear: 0.2, whistle: 0.05 }))),
    n(3, () => bake(0.35, (oc, d) => {
      whoosh(oc, d, { dur: 0.28, lo: 300, hi: 1300, pk: 0.4, q: 0.8, tear: 0.12, whistle: 0 });
      for (const t of [0.01, 0.19]) nz(oc, t, 0.06).connect(filt(oc, 'bandpass', rnd(2500, 3800), 0.9)).connect(perc(oc, t, 0.002, 0.04, 0.5)).connect(d);
      clank(oc, d, 0.03, rnd(3500, 4500), 0.12, 0.06);
    })),
  ]);
  const hx = HERO_EXTRA;
  await put(['hurt', 'hup', 'musouKiai', 'land'], [
    n(3, () => vox(hx.hurt, rnd(0.95, 1.05))), n(2, () => vox(hx.hup, rnd(0.97, 1.03))), vox(hx.musou, 1),
    n(2, () => bake(0.4, (oc, d) => { fall(oc, d, true); })),
  ]);
  // stingers
  await put(['ready', 'flash', 'boom', 'screams', 'horn', 'roar'], [
    bake(2.2, (oc, d) => {
      bell(oc, d, 0, 1046, 0.6, 1.6);
      [1568, 2093, 2637, 3136].forEach((f, i) => osc(oc, 'triangle', 0.05 + i * 0.06, 0.8, f).connect(perc(oc, 0.05 + i * 0.06, 0.002, 0.5, 0.25)).connect(d));
      nz(oc, 0, 0.8).connect(filt(oc, 'highpass', 6000)).connect(perc(oc, 0, 0.01, 0.5, 0.2)).connect(d);
    }, 2),
    bake(2.0, (oc, d) => {                                   // activation: bright crack, metallic shimmer, sub drop
      nz(oc, 0, 0.6).connect(filt(oc, 'highpass', 1500)).connect(perc(oc, 0, 0.001, 0.35, 0.9)).connect(d);
      shimmer(oc, d, 0, 14, 1200, 8000, 0.9, 1.3);
      const s = osc(oc, 'sine', 0, 1.4); pts(s.frequency, 0, [[0, 78], [0.9, 30]], true);
      s.connect(perc(oc, 0, 0.004, 1.0, 1)).connect(shaper(oc, 3)).connect(d);
      whoosh(oc, d, { dur: 0.7, lo: 300, hi: 5000, pk: 0.15, q: 0.9, tear: 0.5, whistle: 0.2 });
    }, 2),
    bake(3.4, (oc, d) => {                                   // finishing blast: crack + saturated sub + wide explosion wash
      nz(oc, 0, 0.3).connect(filt(oc, 'highpass', 1200)).connect(perc(oc, 0, 0.0008, 0.15, 1.4)).connect(d);
      nz(oc, 0, 0.5).connect(filt(oc, 'bandpass', 700, 0.7)).connect(perc(oc, 0, 0.002, 0.3, 1.2)).connect(shaper(oc, 2.5)).connect(d);
      const s = osc(oc, 'sine', 0, 3); pts(s.frequency, 0, [[0, 66], [2.2, 22]], true);
      s.connect(perc(oc, 0, 0.004, 2.2, 0.9)).connect(shaper(oc, 4)).connect(d);
      for (const p of [-0.6, 0.6]) {
        const lp = filt(oc, 'lowpass', 9000, 0.9); pts(lp.frequency, 0, [[0, 9000], [2.4, 160]], true);
        nz(oc, 0, 3.2).connect(lp).connect(perc(oc, 0, 0.003, 1.8, 1.3)).connect(pan(oc, p)).connect(d);
      }
      shimmer(oc, d, 0.02, 18, 1800, 9000, 0.6, 1.6);
      nz(oc, 0, 3.2, 0.2).connect(filt(oc, 'lowpass', 110)).connect(perc(oc, 0.05, 0.1, 2.6, 1.4)).connect(d);
      grains(oc, d, 0.05, 1.2, 60, 3500, 0.35);
    }, 2),
    bake(1.6, (oc, d) => {                                   // mass death chorus
      for (let i = 0; i < 12; i++) { const p = pan(oc, rnd(-0.85, 0.85)); p.connect(d); cry(oc, p, rnd(0, 0.5), rnd(120, 230), rnd(0.4, 1)); }
    }, 2),
    bake(2.8, (oc, d) => {                                   // reinforcement war horn (D3 → A3)
      const lp = filt(oc, 'lowpass', 700, 1.2); pts(lp.frequency, 0, [[0, 500], [0.3, 1300], [2.2, 900]]);
      const vib = osc(oc, 'sine', 0, 2.8, 5.2);
      for (const [f, t0] of [[146.8, 0], [147.6, 0], [220, 0.9]]) {
        const o = osc(oc, 'sawtooth', t0, 2.8 - t0, f), vg = gain(oc, f * 0.006);
        vib.connect(vg).connect(o.frequency); o.connect(env(oc, t0, [[0, 0], [0.25, 0.5], [1.7 - t0 * 0.5, 0.45], [2.5 - t0 * 0.4, 0]])).connect(lp);
      }
      lp.connect(d);
    }, 2),
    bake(2.8, (oc, d) => {                                   // army roar swell
      for (let i = 0; i < 18; i++) smp(oc, d, pick(B.crowd), rnd(0, 0.9), rnd(0.8, 1.05), rnd(0.4, 1), rnd(-0.9, 0.9));
    }, 2),
  ]);
  await loops;
  return B;
}

function bakeLoops(B) {
  return Promise.all([
    bakeLoop(8, 1.2, (oc, d) => {                            // 120 BPM war drums, 4 bars
      const main = 'D..dD.d.D..dDdD.', rimP = '..k...k...k.k..k';
      for (let bar = 0; bar < 2; bar++) for (let i = 0; i < 16; i++) {
        const t = bar * 4 + i * 0.25, c = main[i];
        if (c === 'D') { const p = pan(oc, i % 4 ? 0.15 : -0.1); p.connect(d); taiko(oc, p, t, 1); }
        if (c === 'd') taiko(oc, d, t, 0.5, 1.15);
        if (rimP[i] === 'k') rim(oc, d, t + (bar ? 0.01 : 0), 0.35);
      }
      taiko(oc, d, 0, 1.3, 0.6); taiko(oc, d, 4, 1.3, 0.6);  // odaiko downbeats
    }, 0.9),
    bakeLoop(16, 2, (oc, d) => {                             // distant battle: army voices, clashes, wind, rumble, fire
      const far = filt(oc, 'lowpass', 3400); far.connect(d);        // distance: dark; the runtime reverb send adds the space
      for (let i = 0; i < 52; i++) smp(oc, far, pick(B.crowd), rnd(0, 16), rnd(0.85, 1.15), rnd(0.25, 1), rnd(-1, 1));
      for (let i = 0; i < 34; i++) smp(oc, far, pick(B.clank), rnd(0, 16), rnd(0.6, 1.3), rnd(0.12, 0.4), rnd(-1, 1));
      const xf = xfade(16, 2);
      const wl = filt(oc, 'lowpass', 500, 0.8), wlfo = osc(oc, 'sine', 0, 18, 1 / 8), wg = gain(oc, 220);
      wlfo.connect(wg).connect(wl.frequency);
      nz(oc, 0, 18).connect(wl).connect(xf(oc)).connect(gain(oc, 0.5)).connect(d);
      nz(oc, 0, 18, 0.25).connect(filt(oc, 'lowpass', 95)).connect(xf(oc)).connect(gain(oc, 0.45)).connect(d);
      // high-band battle air: dense far blade clashes + a breathing hiss, so the top end never drops out between hits
      for (let i = 0; i < 400; i++) { const t = rnd(0, 16); nz(oc, t, 0.014).connect(filt(oc, 'bandpass', rnd(3500, 9000), 2)).connect(perc(oc, t, 0.0005, rnd(0.004, 0.014), rnd(0.03, 0.11))).connect(pan(oc, rnd(-0.9, 0.9))).connect(d); }
      const hl = filt(oc, 'highpass', 4200, 0.7), hlfo = osc(oc, 'sine', 0, 18, 1 / 4), hg = gain(oc, 0.09), hm = gain(oc, 0.04);
      hlfo.connect(hm).connect(hg.gain);
      nz(oc, 0, 18).connect(hl).connect(xf(oc)).connect(hg).connect(d);
      for (let i = 0; i < 90; i++) { const t = rnd(0, 16); nz(oc, t, 0.01).connect(filt(oc, 'bandpass', rnd(2500, 5000), 1.2)).connect(perc(oc, t, 0.0005, rnd(0.003, 0.01), rnd(0.08, 0.25))).connect(pan(oc, rnd(-0.5, 0.5))).connect(d); }
    }, 0.9),
    bakeLoop(16, 1, (oc, d) => riff(oc, d), 0.9),              // 2 × the drum loop length: both start together and stay locked
  ]).then(([drums, bed, music]) => { B.drums = drums; B.bed = bed; B.music = music; });
}
