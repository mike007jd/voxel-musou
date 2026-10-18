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
  page.on('pageerror', (e) => console.warn('pageerror', e.message));
  await page.addInitScript(() => {
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

const server = await serve();
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
const { chromium } = await import(await loadPlaywright());
const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-gpu-blocklist',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'],
});

try {
  await withPage(browser, `${base}/`, async (page) => {
    await setFake(page, [{ index: 1, mapping: 'standard' }]);
    await page.waitForFunction(() => {
      const t = document.getElementById('title');
      return t && !t.hidden && !document.body.classList.contains('inkhold');
    }, { timeout: 90_000 });
    await pause(page, 200);
    await setFake(page, [{ index: 1, mapping: 'standard', down: { 0: true } }]);
    await page.waitForFunction(() => !document.getElementById('title').classList.contains('pre'), { timeout: 5_000 });
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
  });

  await withPage(browser, `${base}/?go=free&char=zhaoyun&enemies=0&testpad=1`, async (page) => {
    await setFake(page, [{ index: 1, mapping: 'standard' }]);
    await page.waitForFunction(() => window.__vmTest && window.__vmTest.state === 'battle' && !window.__vmTest.paused,
      { timeout: 90_000 });
    const origin = await page.evaluate(() => {
      const h = window.__vmTest.game.hero;
      return { x: h.x, z: h.z, move: h.move, state: h.state };
    });
    await setFake(page, [{ index: 1, mapping: 'standard', axes: [0, -1, 0, 0] }]);
    await page.waitForFunction((z0) => Math.abs(window.__vmTest.game.hero.z - z0) > 0.4, origin.z, { timeout: 5_000 });
    const moved = await page.evaluate(() => {
      const h = window.__vmTest.game.hero;
      return { x: h.x, z: h.z, state: h.state };
    });
    assert.ok(Math.hypot(moved.x - origin.x, moved.z - origin.z) > 0.4,
      `hero moved ${JSON.stringify(origin)} → ${JSON.stringify(moved)}`);
    console.log(`battle move: (${origin.x.toFixed(2)}, ${origin.z.toFixed(2)}) → (${moved.x.toFixed(2)}, ${moved.z.toFixed(2)})`);

    await setFake(page, [{ index: 1, mapping: 'standard' }]);
    await pause(page, 80);
    await setFake(page, [{ index: 1, mapping: 'standard', down: { 2: true } }]);
    await page.waitForFunction(() => window.__vmTest.game.hero.move === 'n1' || window.__vmTest.game.hero.buf === 'attack',
      { timeout: 3_000 });
    console.log('battle attack: n1 / attack buffer from slot-1 X');

    await setFake(page, [{ index: 1, mapping: 'standard' }]);
    await pause(page, 80);
    await setFake(page, [{ index: 1, mapping: 'standard', down: { 3: true } }]);
    await page.waitForFunction(() => {
      const h = window.__vmTest.game.hero;
      return h.move === 'c1' || h.buf === 'charge';
    }, { timeout: 3_000 });
    console.log('battle charge: c1 / charge buffer from slot-1 Y');

    await setFake(page, [{ index: 1, mapping: 'standard' }]);
    await pause(page, 80);
    await setFake(page, [{ index: 1, mapping: 'standard', down: { 0: true } }]);
    await page.waitForFunction(() => {
      const h = window.__vmTest.game.hero;
      return h.state === 'jump' || h.jumpBuf > 0;
    }, { timeout: 3_000 });
    console.log('battle jump: jump state / buffer from slot-1 A');

    await setFake(page, [{ index: 1, mapping: 'standard' }]);
    await pause(page, 200);
    await setFake(page, [{ index: 1, mapping: 'standard', down: { 5: true } }]);
    await page.waitForFunction(() => {
      const h = window.__vmTest.game.hero;
      return h.state === 'dodge' || h.dodgeBuf > 0;
    }, { timeout: 3_000 });
    console.log('battle dodge: dodge state / buffer from slot-1 R1');

    await setFake(page, [{ index: 1, mapping: 'standard' }]);
    await pause(page, 80);
    const yaw0 = await page.evaluate(() => window.__vmTest.game.cam.yaw);
    await setFake(page, [{ index: 1, mapping: 'standard', axes: [0, 0, 1, 0.6] }]);
    await page.waitForFunction((y0) => Math.abs(window.__vmTest.game.cam.yaw - y0) > 0.05, yaw0, { timeout: 3_000 });
    const yaw1 = await page.evaluate(() => window.__vmTest.game.cam.yaw);
    console.log(`battle camera: yaw ${yaw0.toFixed(3)} → ${yaw1.toFixed(3)} from slot-1 right stick`);

    await setFake(page, [{ index: 1, mapping: 'standard' }]);
    await pause(page, 80);
    await setFake(page, [{ index: 1, mapping: 'standard', down: { 4: true } }]);
    await page.waitForFunction(() => window.__vmTest.game.cam.turn, { timeout: 3_000 });
    console.log('battle target: camera recenter from slot-1 L1');

    await setFake(page, [{ index: 1, mapping: 'standard' }]);
    await pause(page, 400);
    await page.evaluate(() => { window.__vmTest.game.hero.musou = window.__vmTest.game.hero.musouMax; });
    await setFake(page, [{ index: 1, mapping: 'standard', down: { 1: true } }]);
    await page.waitForFunction(() => {
      const h = window.__vmTest.game.hero, g = window.__vmTest.game;
      return h.state === 'musou' || h.musouBuf > 0 || g.musou.active;
    }, { timeout: 3_000 });
    console.log('battle musou: started / buffered from slot-1 B');
  });
} finally {
  await browser.close();
  server.close();
}

console.log('Headless Chromium: injected pad in slot 1 drives the title menu and battle — passed');
