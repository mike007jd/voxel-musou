// Run: node checks/gamepad-browser.mjs
// Headless Chromium against a local index.html: inject fake Gamepads and assert
// the title menu and an in-battle hero respond. Needs system Chrome + playwright-core
// (installed into $TMP if missing). No real USB pad; the Windows exe wrapper is not here.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg',
  '.png': 'image/png', '.gif': 'image/gif', '.mp4': 'video/mp4' };

function serve() {
  const server = createServer(async (req, res) => {
    const path = join(root, decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\//, '') || 'index.html');
    try {
      const data = await readFile(path);
      res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' });
      res.end(data);
    } catch { res.writeHead(404); res.end(); }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function loadPlaywright() {
  try { return createRequire(import.meta.url).resolve('playwright-core'); } catch { /* not in the repo */ }
  const dir = join(process.env.TMPDIR || '/tmp', 'vm-playwright-core');
  const req = () => createRequire(join(dir, 'package.json')).resolve('playwright-core');
  try { return req(); } catch { /* install */ }
  return (async () => {
    await mkdir(dir, { recursive: true });
    if (!existsSync(join(dir, 'package.json'))) execSync('npm init -y', { cwd: dir, stdio: 'ignore' });
    execSync('npm install --no-save --no-audit --no-fund playwright-core@1.56.1', { cwd: dir, stdio: 'inherit' });
    return req();
  })();
}

async function withPage(browser, url, fn) {
  const page = await browser.newPage();
  page.setDefaultTimeout(120_000);
  page.on('pageerror', (e) => console.warn('pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.warn('console', m.text()); });
  await page.addInitScript(() => {
    // Headless Chrome's AudioContext is often 44100; the bank bakes at 48000 and
    // createAudio() would otherwise throw (ConvolverNode) and abort boot.
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      class AudioContext48k extends AC {
        constructor(opts = {}) { super({ ...opts, sampleRate: 48000 }); }
      }
      window.AudioContext = AudioContext48k;
      window.webkitAudioContext = AudioContext48k;
    }
    // Headless Chromium blurs the tab; main.js pauses the battle on blur.
    addEventListener('blur', (e) => e.stopImmediatePropagation(), true);
    window.__fakePads = [null, null, null, null];
    navigator.getGamepads = () => window.__fakePads;
    window.__setFakePads = (rows) => {
      window.__fakePads = [null, null, null, null];
      for (const r of rows) {
        if (!r) continue;
        const n = r.n || (r.mapping === 'standard' ? 17 : 10);
        const buttons = Array.from({ length: n }, (_, i) => {
          const on = !!(r.down && r.down[i]);
          return { pressed: on, touched: on, value: on ? 1 : 0 };
        });
        window.__fakePads[r.index] = {
          index: r.index, mapping: r.mapping || 'standard', id: 'Fake Xbox 360 Controller',
          connected: true, timestamp: performance.now(), axes: r.axes || [0, 0, 0, 0], buttons,
        };
      }
    };
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  try { return await fn(page); }
  finally { await page.close(); }
}

const setFake = (page, rows) => page.evaluate((list) => window.__setFakePads(list), rows);
const pause = (page, ms) => page.evaluate((t) => new Promise((r) => setTimeout(r, t)), ms);
const tick = (page, n = 1) => page.evaluate((k) => { for (let i = 0; i < k; i++) window.__vmTest.step(); }, n);
const snapHero = (page) => page.evaluate(() => {
  const h = window.__vmTest.game.hero, c = window.__vmTest.game.cam, m = window.__vmTest.game.musou;
  return { x: h.x, z: h.z, move: h.move, state: h.state, buf: h.buf, jumpBuf: h.jumpBuf, dodgeBuf: h.dodgeBuf,
    musouBuf: h.musouBuf, musouOn: !!(m && m.active), yaw: c.yaw, turn: !!c.turn, paused: window.__vmTest.paused };
});
const finishMove = async (page) => {
  await setFake(page, [{ index: 1, mapping: 'standard' }]);
  for (let i = 0; i < 8; i++) {
    await tick(page, 20);
    const s = await snapHero(page);
    if (!s.move && (s.state === 'idle' || s.state === 'run' || s.state === 'land')) return s;
  }
  throw new Error(`hero did not return to idle: ${JSON.stringify(await snapHero(page))}`);
};

const server = await serve();
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
const pw = await import(await loadPlaywright());
const { chromium } = pw.chromium ? pw : pw.default;
const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-gpu-blocklist',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl', '--enable-webgl2'],
});

try {
  await withPage(browser, `${base}/`, async (page) => {
    await setFake(page, [{ index: 1, mapping: 'standard' }]);
    try {
      await page.waitForFunction(() => {
        const t = document.getElementById('title');
        return t && !t.hidden;
      }, null, { timeout: 120_000 });
    } catch (err) {
      console.warn('title boot dump', await page.evaluate(() => ({
        titleHidden: document.getElementById('title')?.hidden,
        titleClass: document.getElementById('title')?.className,
        inkhold: document.body.classList.contains('inkhold'),
        inkText: document.querySelector('#ink')?.innerText?.slice(0, 240),
        gl: (() => { try { return !!document.getElementById('c').getContext('webgl2'); } catch (e) { return String(e); } })(),
      })));
      throw err;
    }
    await page.waitForFunction(() => !document.body.classList.contains('inkhold'), null, { timeout: 60_000 }).catch(() => {});
    await pause(page, 200);
    await setFake(page, [{ index: 1, mapping: 'standard', down: { 0: true } }]);
    await page.waitForFunction(() => !document.getElementById('title').classList.contains('pre'), null, { timeout: 8_000 });
    await setFake(page, [{ index: 1, mapping: 'standard' }]);
    await pause(page, 80);
    const before = await page.evaluate(() => [...document.querySelectorAll('#title .t-main button')].findIndex((b) => b.classList.contains('on')));
    await setFake(page, [{ index: 1, mapping: 'standard', down: { 13: true } }]);
    await page.waitForFunction((i) => {
      const k = [...document.querySelectorAll('#title .t-main button')].findIndex((b) => b.classList.contains('on'));
      return k !== i && k >= 0;
    }, before, { timeout: 5_000 });
    const after = await page.evaluate(() => [...document.querySelectorAll('#title .t-main button')].findIndex((b) => b.classList.contains('on')));
    assert.equal(after, (before + 1) % 4, `title menu moved ${before} → ${after}`);
    console.log(`menu: slot-1 d-pad moved title focus ${before} → ${after}`);
    await page.screenshot({ path: join(process.env.ARTIFACTS || '/opt/cursor/artifacts', 'gamepad_title_menu_slot1.png') });
  });

  await withPage(browser, `${base}/?go=free&char=zhaoyun&enemies=0&testpad=1`, async (page) => {
    await setFake(page, [{ index: 1, mapping: 'standard' }]);
    await page.waitForFunction(() => window.__vmTest && window.__vmTest.state === 'battle', null, { timeout: 120_000 });
    await page.evaluate(() => { if (window.__vmTest.paused) window.__vmTest.setPaused(false); });
    await page.waitForFunction(() => !document.body.classList.contains('inkhold') && document.getElementById('ink')?.hidden,
      null, { timeout: 60_000 }).catch(() => {});
    const origin = await snapHero(page);
    await setFake(page, [{ index: 1, mapping: 'standard', axes: [0, -1, 0, 0] }]);
    await tick(page, 24);
    const moved = await snapHero(page);
    assert.ok(Math.hypot(moved.x - origin.x, moved.z - origin.z) > 0.4,
      `hero moved ${JSON.stringify(origin)} → ${JSON.stringify(moved)}`);
    console.log(`battle move: (${origin.x.toFixed(2)}, ${origin.z.toFixed(2)}) → (${moved.x.toFixed(2)}, ${moved.z.toFixed(2)})`);
    await page.screenshot({ path: join(process.env.ARTIFACTS || '/opt/cursor/artifacts', 'gamepad_battle_after_move.png') });

    await finishMove(page);
    await setFake(page, [{ index: 1, mapping: 'standard', down: { 2: true } }]);
    await tick(page, 2);
    const atk = await snapHero(page);
    assert.ok(atk.move === 'n1' || atk.buf === 'attack', `attack ${JSON.stringify(atk)}`);
    console.log('battle attack: n1 / attack buffer from slot-1 X');

    await finishMove(page);
    await setFake(page, [{ index: 1, mapping: 'standard', down: { 3: true } }]);
    await tick(page, 2);
    const chg = await snapHero(page);
    assert.ok(chg.move === 'c1' || chg.buf === 'charge', `charge ${JSON.stringify(chg)}`);
    console.log('battle charge: c1 / charge buffer from slot-1 Y');

    await finishMove(page);
    await setFake(page, [{ index: 1, mapping: 'standard', down: { 0: true } }]);
    await tick(page, 2);
    const jmp = await snapHero(page);
    assert.ok(jmp.state === 'jump' || jmp.jumpBuf > 0, `jump ${JSON.stringify(jmp)}`);
    console.log('battle jump: jump state / buffer from slot-1 A');

    await finishMove(page);
    await setFake(page, [{ index: 1, mapping: 'standard', down: { 5: true } }]);
    await tick(page, 2);
    const ddg = await snapHero(page);
    assert.ok(ddg.state === 'dodge' || ddg.dodgeBuf > 0, `dodge ${JSON.stringify(ddg)}`);
    console.log('battle dodge: dodge state / buffer from slot-1 R1');

    await finishMove(page);
    const yaw0 = (await snapHero(page)).yaw;
    await setFake(page, [{ index: 1, mapping: 'standard', axes: [0, 0, 1, 0.6] }]);
    await tick(page, 12);
    const look = await snapHero(page);
    assert.ok(Math.abs(look.yaw - yaw0) > 0.05, `camera yaw ${yaw0} → ${look.yaw}`);
    console.log(`battle camera: yaw ${yaw0.toFixed(3)} → ${look.yaw.toFixed(3)} from slot-1 right stick`);

    await setFake(page, [{ index: 1, mapping: 'standard' }]);
    await tick(page, 20);   // let right-stick ease die so a look tail does not eat the recenter
    await setFake(page, [{ index: 1, mapping: 'standard', down: { 4: true } }]);
    await tick(page, 1);
    const tgt = await snapHero(page);
    assert.ok(tgt.turn, `target ${JSON.stringify(tgt)}`);
    console.log('battle target: camera recenter from slot-1 L1');

    await finishMove(page);
    await page.evaluate(() => { window.__vmTest.game.hero.musou = window.__vmTest.game.hero.musouMax; });
    await setFake(page, [{ index: 1, mapping: 'standard', down: { 1: true } }]);
    await tick(page, 3);
    const mu = await snapHero(page);
    assert.ok(mu.state === 'musou' || mu.musouBuf > 0 || mu.musouOn, `musou ${JSON.stringify(mu)}`);
    console.log('battle musou: started / buffered from slot-1 B');
  });
} finally {
  await browser.close();
  server.close();
}

console.log('Headless Chromium: injected pad in slot 1 drives the title menu and battle — passed');
