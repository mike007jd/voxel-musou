// Boot, flow and the fixed 60 Hz loop. Sim modules (hero, combat, crowd, actors, pickups, musou, story, camera control yaw) advance only
// in step(); render-side modules read sim state in render() and never write it.
// Flow: title → select → loading → (story: prologue →) battle → (story / trial: result →) title. Each non-battle state is a DOM screen (index.html
// #title #select #loading #prologue #result, modules below: createX(el, flow) → { enter(ctx), exit(), view? }; view(scene, camera,
// focus, dt) = optional render-only camera/stage hook run after the gameplay rig while that screen is up); the sim only steps in
// 'battle' and not paused (Esc: pause menu #menu). startBattle() resets the sim for a character / mode / chapter.
// ctx through the flow: title → select { mode, ch, map } (mode 'story': ch = the chapter, story/chapters.js; 'trial':
// ch = the trial, story/trials.js; 'free': ch = the battlefield's chapter, map = its field) → loading / prologue / battle
// { mode, ch, map, char, art?, retry? } → result (+ win, stats, reason?, diff, rec?) → title (+ mode, ch after a win:
// the chapter / trial panel opens there). rec = core/progress.js record()'s result for the win.
// flow.go() returns a promise that settles once the new state's materials are compiled and two frames have presented
// (menu.js inkWipe holds the ink until then; the page boots under it, inkBoot). Every screen change but prologue →
// battle (its own fade onto the live field) goes through the ink wipe; the HUD slides in on each battle entry (#hud.in).
// 'loading' (after 出陣, or 再戰 on the result) runs deploy(): once the card is fully uncovered, startBattle for the chosen
// officer (flow.go('battle') then keeps it: no second reset under a visible field), compile, warm frames
// (the bar tracks those real stages), a minimum dwell, then ink on into the prologue / battle — the officer on the field
// is the chosen one before anything of the field is seen again, and his kit's first draws never stall on screen.
// Select → loading also snaps the select stage's key-art frame of the officer (snapArt) for the loading card and result.
// Maps: startBattle loads the battle's map (world.load: in-page, under the loading card / ink); the title and select
// always stand on HOME (flow.go('title') swaps back under the ink and clears the last battle's soldiers).
// Dev shortcut: ?go=free|story|trial[&char=id][&ch=chapter / trial id][&map=map id] skips the screens straight into a
// battle (story without &ch: the first chapter that lists the officer).
import * as THREE from 'three';
import { vrng, rng } from './core/rng.js';
import { emit, on, collect } from './core/events.js';
import { createInput } from './core/input.js';
import { createPost } from './post/post.js';
import { createWorld } from './world/world.js';
import { createHero, createHeroView } from './hero/hero.js';
import { createCrowd } from './crowd/crowd.js';
import { createCrowdView } from './crowd/view.js';
import { armyPair, FREE_ARMY } from './crowd/armies.js';
import { createCombat } from './combat/combat.js';
import { createActors } from './actors/actors.js';
import { createActorsView } from './actors/view.js';
import { createPickups, createPickupsView } from './actors/pickups.js';
import { createCamSim, createCameraRig } from './camera/camera.js';
import { createVfx } from './vfx/vfx.js';
import { createHud } from './ui/hud.js';
import { createAudio } from './audio/audio.js';
import { CHARS } from './chars/index.js';
import { spawnPoint, MAP } from './world/map.js';
import { HOME } from './world/maps/index.js';
import { createStory } from './story/index.js';
import { CHAPTERS, chapter } from './story/chapters.js';
import { createTitle, CONTROLS } from './ui/title.js';
import { createSelect } from './ui/select.js';
import { createLoading } from './ui/loading.js';
import { inkWipe, inkBoot, wiping, createNav, sfx, replay } from './ui/menu.js';
import { createPrologue } from './story/prologue.js';
import { createResult } from './story/result.js';
import { difficulty } from './core/difficulty.js';
import { record } from './core/progress.js';

const params = new URLSearchParams(location.search);
const ENEMIES = Math.max(0, Math.min(2000, params.get('enemies') ? Number(params.get('enemies')) | 0 : 300));

const canvas = document.getElementById('c');
let vw = innerWidth, vh = innerHeight;

const post = createPost({ canvas, width: vw, height: vh });
const scene = new THREE.Scene();
const world = createWorld(scene, post);          // loads HOME

// ---- sim
// mode: 'free' | 'story' | 'trial' (set by startBattle); the hero's character / kit: game.hero.char / game.hero.kit; army: the
// battle's { foe, ally } (crowd/armies.js, set by startBattle before any view rebuild)
const game = { frame: 0, hitstop: 0, freeze: 0, mode: 'free', diff: difficulty(), army: armyPair(FREE_ARMY) };   // diff: core/difficulty.js, fixed per battle
game.cam = createCamSim();
game.hero = createHero(game);
game.crowd = createCrowd(game, ENEMIES);
game.combat = createCombat(game);
game.actors = createActors(game);                 // hero-model NPCs: the boss, allied officers (src/actors, CONTRACTS C5)
game.pickups = createPickups(game);               // 肉包 heals dropped by officers / every 40th grunt
game.musou = game.hero.kit.createMusou(game);     // the character's Musou (rebuilt with the kit in startBattle)
game.story = createStory(game);
const input = createInput();

// ---- render side
let crowdView = createCrowdView(scene, game);          // rebuilt when the battle's army pair changes (startBattle)
const camRig = createCameraRig(game, vw, vh);
const vfx = createVfx(scene, game, world);
// actor models are built on spawn and shown once compiled (post.compile: parallel, no stall mid-battle)
const actorsView = createActorsView(scene, game, () => post.compile(scene, camRig.camera));
const pickupsView = createPickupsView(scene, game);
// kit views (hero model + chains + ghosts, Musou grade/dragon/cut-in): rebuilt when the character's kit changes
let heroView, musouView, dropViews = null;
function buildViews() {
  if (dropViews) { dropViews(); heroView.dispose(); musouView.dispose(); }
  [[heroView, musouView], dropViews] = collect(() => [createHeroView(scene, game.hero), game.hero.kit.createMusouView(scene, game, camRig.camera)]);
}
buildViews();
// hud part: camera passed so officer name/HP tags can be projected over their heads (read-only)
const hud = createHud(document.getElementById('hud'), game, camRig.camera);
createAudio(game);

function step() {
  const inp = input.sample();
  game.cam.step(game, inp);
  game.hero.step(inp);
  game.combat.step();
  game.crowd.step();
  game.actors.step(); game.pickups.step();
  game.musou.step();
  game.story.step();
  game.frame++;
  vfx.afterStep();
}

let lastRenderFrame = 0;
/** real: wall-clock dt while a screen is up (the field idles behind it: fires, flags, cloth keep moving); battle: sim time. */
function render(real) {
  const dt = real ?? Math.min(10, Math.max(0, (game.frame - lastRenderFrame) / 60));
  lastRenderFrame = game.frame;
  heroView.root.visible = state !== 'title' && state !== 'select';   // no officer chosen yet: the field stands empty
  actorsView.root.visible = pickupsView.root.visible = heroView.root.visible;
  heroView.update(Math.min(dt, 0.1));
  crowdView.update(dt, camRig.camera);
  actorsView.update(dt); pickupsView.update();
  vfx.update(dt);
  camRig.update(dt);
  screens[state]?.view?.(scene, camRig.camera, camRig.focus, dt);   // ui lane: a screen may frame the idle field itself
  world.update(dt, camRig.focus, game);
  musouView.update(dt);
  post.render(scene, camRig.camera, game.frame / 60, camRig.focus, vfx.flash);   // post-fx: DoF focus + screen flash
  hud.update();
}

/** New battle: { char: CHARS id, mode: 'story' | 'trial' | 'free', ch: chapter / trial id, map: maps/index.js id (free;
 *  default HOME) }. Sets the armies, loads the map (no-op if it is up), resets every sim module (deterministic from here: both
 *  RNGs reseeded, frame 0), rebuilds the kit views on a character change, lets the story spawn the field. */
function startBattle({ char = 'zhaoyun', mode = 'free', ch, map } = {}) {
  const C = mode === 'free' ? null : chapter(ch);                                         // C2: the chapter / trial
  const who = CHARS[char] || CHARS.zhaoyun, newKit = who.kit !== game.hero.kit;
  char = who.id; ch = C?.CH.id; map = C ? C.CH.map : map || HOME;                          // C2: resolved ids
  const prev = game.army; game.army = armyPair(C ? C.CH.army : CHAPTERS.find((m) => m.CH.map === map)?.CH.army ?? FREE_ARMY);              // C3
  if (game.army.foe !== prev.foe || game.army.ally !== prev.ally) { crowdView.dispose(); crowdView = createCrowdView(scene, game); }
  world.load(map, { army: game.army });                                                    // C1
  map = MAP.id;
  const p = { ...spawnPoint(mode), ...C?.CH.start };                                      // C2 (also opens every gate; a trial: the free arena)
  Object.assign(game, { mode, frame: 0, hitstop: 0, freeze: 0, diff: difficulty() });
  lastRenderFrame = 0;
  vrng.seed(7936); rng.seed(1);
  game.hero.reset({ ...p, char: who });
  if (newKit) game.musou = who.kit.createMusou(game);
  game.cam.reset(p.yaw); game.cam.tilt = p.tilt || 0;           // first: crowd.reset takes the allies' front from the camera yaw
  game.crowd.reset(); game.combat.reset(); game.musou.reset();
  if (newKit) buildViews();
  heroView.reset();
  game.actors.reset(); game.pickups.reset();                                              // C5
  game.story.reset({ mode, char, ch });                                                    // C2
  menu.querySelector('.t').innerHTML = `${who.name.zh}<i>${who.seal}</i>`;
  menu.querySelector('.sub').innerHTML = `戰局暫停・${game.diff.zh}<small>Battle paused · ${game.diff.en}</small>`;
  document.title = `${who.name.zh} — Voxel Musou`;
  emit('scenario', { mode, char, ch, map });
}

addEventListener('resize', () => {
  vw = innerWidth; vh = innerHeight;
  post.setSize(vw, vh);
  camRig.resize(vw, vh);
  render();
});

// ---- flow + pause menu (index.html #menu, battle only): the sim waits while it is open or while a screen is up
const $ = (id) => document.getElementById(id);
const menu = $('menu'), hudEl = $('hud');
// the bindings mid-battle too (critic: checking aim meant quitting the chapter)
menu.querySelector('.hint').insertAdjacentHTML('beforebegin', `<table>${CONTROLS.map(([zh, en, kb, pad]) => `<tr><td>${zh}<small>${en}</small></td><td>${kb}</td><td class="pad">${pad}</td></tr>`).join('')}</table>`);
let paused = false, state = null, ctx = {}, hold = false;   // hold: loading, no renders until the new kit is compiled
// pause menu: title-screen vocabulary (diamond + swash on the focused item), 繼續 focused on open, ↑/↓ / pad move,
// Enter / A confirm, Esc / B resume. 撤退 asks once (確定撤退？), a second confirm ink-wipes to the title.
const mBtns = [$('go'), $('quit')], quitEl = $('quit');
let mCur = 0, quitArm = false;
const armQuit = (v) => {
  quitArm = v; quitEl.classList.toggle('arm', v);
  quitEl.innerHTML = v ? '確定撤退？<small>Confirm · progress is lost</small>' : '撤退<small>Quit to title</small>';
};
const mFocus = (i) => {
  mCur = (i + mBtns.length) % mBtns.length;
  mBtns.forEach((b, k) => b.classList.toggle('on', k === mCur));
  if (mCur !== 1 && quitArm) armQuit(false);
};
const mOk = () => {
  if (mCur === 0) return setPaused(false);
  if (!quitArm) { sfx('ok'); return armQuit(true); }
  sfx('back'); mNav.stop();
  inkWipe(() => flow.go('title'));
};
const mNav = createNav({ move: (d) => { mFocus(mCur + d); sfx('move'); }, ok: mOk, back: () => setPaused(false) });
const setPaused = (v) => {
  paused = v; menu.hidden = !v; hudEl.hidden = v; input.sample();   // sample(): drop keys pressed on the menu
  if (v) { mFocus(0); armQuit(false); mNav.start(); } else mNav.stop();
};
mBtns.forEach((b, i) => {
  b.addEventListener('pointerenter', () => { if (mCur !== i) { mFocus(i); sfx('move'); } });
  b.addEventListener('click', () => { mFocus(i); mOk(); });
});
const flow = {
  /** Enter a flow state: 'title' | 'select' | 'loading' | 'prologue' | 'battle' | 'result' (ctx: see each screen module). */
  go(s, c = {}) {
    if (s === 'loading' && state === 'select') c.art = arts[c.char] = snapArt();
    if (screens[state]) { screens[state].exit(); $(state).hidden = true; }
    const set = state === 'loading' || state === 'prologue';   // deploy() already started this battle (its field is on screen)
    state = s; ctx = c;
    if (s === 'title') { world.load(HOME); game.crowd.reset(); }   // menus stand on HOME, the field empty (under the ink)
    if (s === 'battle') { if (!set) startBattle(c); setPaused(false); replay(hudEl, 'in'); }
    else { setPaused(false); hudEl.hidden = true; $(s).hidden = false; screens[s].enter(c); }
    emit('flow', { state: s, ctx: c });
    if (s === 'loading') { deploy(c); return nextFrame(); }
    // Results and the prologue only change DOM; a deployed battle is already compiled and presented.
    return warm(s === 'title' || s === 'select' || (s === 'battle' && !set));
  },
};
const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Compile every material in the scene (hidden pools included) for this camera, in parallel where the GPU has
 *  KHR_parallel_shader_compile, then let two frames present: the screen's first draws don't stall. */
async function warm(compile = true) {
  screens[state]?.view?.(scene, camRig.camera, camRig.focus, 0);   // a screen's stage (select: the focused officer's model) exists now
  if (compile) await post.compile(scene, camRig.camera);
  await nextFrame(); await nextFrame();
}
/** Key-art still of the officer focused on the select stage, taken under full ink: one render in the select screen's
 *  key-art framing, read back in the same task (no preserveDrawingBuffer needed). Cached per officer (retry reuses it). */
const arts = {};
function snapArt() {
  const S = screens.select;
  S.keyart(true); render(0); S.keyart(false);
  try { return canvas.toDataURL('image/jpeg', 0.9); } catch { return null; }
}
/** Under the loading card: the chosen officer's battle, compiled and rendered a few frames, then ink on into it.
 *  Runs only once the card is fully uncovered (the synchronous build would otherwise freeze the ink over it); each
 *  stage is labelled on the card and the bar gets two frames to start moving before the main thread blocks. */
async function deploy(c) {
  const L = screens.loading;
  hold = true;
  while (wiping()) await nextFrame();
  if (state !== 'loading') return;
  const t0 = performance.now(), stage = async (p, zh, en) => { L.progress(p, zh, en); await nextFrame(); await nextFrame(); };
  await stage(0.18, '點將', 'Summoning the officer');
  startBattle(c);
  await stage(0.5, '佈陣', 'Deploying the ranks');
  await post.compile(scene, camRig.camera);
  await stage(0.82, '整軍備戰', 'Preparing the field');
  hold = false;                                    // the loop renders the field behind the card: shadow / first-draw variants
  for (let i = 0; i < 4; i++) await nextFrame();
  L.progress(1);
  await sleep(Math.max(500, 1300 - (performance.now() - t0)));   // the card stays readable >= 1.3 s once revealed
  if (state !== 'loading') return;
  L.ready(); sfx('ok');
  await sleep(450);
  if (state !== 'loading') return;
  inkWipe(() => flow.go(c.mode === 'story' && !c.retry ? 'prologue' : 'battle', c));
}
const screens = {
  title: createTitle($('title'), flow), select: createSelect($('select'), flow), loading: createLoading($('loading')),
  prologue: createPrologue($('prologue'), flow), result: createResult($('result'), flow),
};
// a win goes into the records (rec: what it beat and what it opened — the result screen shows both); reason: a fail
// beat's defeat line
on('story:end', (e) => {
  const rec = e.win ? record(ctx.ch, game.hero.char.id, game.diff.id, e.stats) : null;
  inkWipe(() => flow.go('result', { ...ctx, char: game.hero.char.id, win: e.win, stats: e.stats, reason: e.reason, diff: game.diff, rec }));
});
addEventListener('keydown', (e) => {
  // opens; the menu's own nav (registered first) closes it and marks the key handled
  if (state === 'battle' && !paused && e.code === 'Escape' && !e.defaultPrevented) setPaused(true);
});
addEventListener('blur', () => { if (state === 'battle') setPaused(true); });

// ---- loop
let acc = 0, last = performance.now();
const frame = (now) => {
  requestAnimationFrame(frame);
  // clamp at 0 too: the first rAF timestamp can precede the performance.now() taken at module init
  const d = Math.min(0.1, Math.max(0, (now - last) / 1000));
  acc += d * (game.timeScale ?? 1); last = now;                                  // story: victory slow-mo
  if (paused) { acc = 0; input.sample(); return; }
  if (state !== 'battle') { acc = 0; input.sample(); if (!hold) render(d); return; }     // screens: the field idles behind them
  let n = 0;
  while (acc >= 1 / 60 && n < 4 && state === 'battle') { step(); acc -= 1 / 60; n++; }
  if (n === 4) acc = 0;
  render();
};

const dev = params.get('go');
// the page opens under full ink (index.html): the first screen is built and compiled under it, then the ink sweeps off
const devChar = params.get('char') || 'zhaoyun';
const devCh = chapter(params.get('ch') || CHAPTERS.find((m) => m.CH.heroes.includes(devChar))?.CH.id).CH.id;
inkBoot(() => dev ? flow.go('battle', { mode: ['story', 'trial'].includes(dev) ? dev : 'free', char: devChar, ch: devCh, map: params.get('map') || undefined }) : flow.go('title'));
requestAnimationFrame(frame);
// checks/gamepad-browser.mjs: expose the sim so an injected pad can be asserted against movement / actions
if (params.has('testpad')) globalThis.__vmTest = { game, input, get paused() { return paused; }, get state() { return state; } };
