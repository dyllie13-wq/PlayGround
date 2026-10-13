// scripts/smoke-game.mjs — gameplay smoke test (uses same headed config as capture).
// Usage: node scripts/smoke-game.mjs http://localhost:3102/
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const url = process.argv[2] || 'http://localhost:3102/';
const runtime = join(process.env.HOME, '.local/share/omgithub-playwright');
const req = createRequire(join(runtime, 'node_modules', 'playwright', 'package.json'));
const { chromium } = req('playwright');
const config = JSON.parse(readFileSync(join(runtime, 'linux.json'), 'utf8'));
try { process.env.DISPLAY ||= ':' + readFileSync(join(runtime, 'display'), 'utf8').trim(); } catch {}

let browser;
try {
  browser = await chromium.launch({ ...config.browser.launchOptions, timeout: 30000 });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction(() => window.__altlife && window.__altlife.state && window.__altlife.state.px > 0, null, { timeout: 15000 });
  const s0 = await page.evaluate(() => ({ ...window.__altlife.state }));
  // hold D (move right) for 1s
  await page.keyboard.down('d');
  await page.waitForTimeout(1000);
  await page.keyboard.up('d');
  const s1 = await page.evaluate(() => ({ ...window.__altlife.state }));
  // press E near a car? just check no crash + clock advances + canvas non-blank
  const px = await page.evaluate(() => {
    const c = document.getElementById('gameCanvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 3; i < d.length; i += 4013) if (d[i] > 0) lit++;
    return { lit, w: c.width, h: c.height };
  });
  const moved = Math.hypot(s1.px - s0.px, 0);
  console.log(JSON.stringify({ s0, s1, moved, px, errors }));
  if (errors.length) { console.error('PAGE_ERRORS: ' + errors.join(' | ')); process.exit(1); }
  if (!(px.lit > 50)) { console.error('CANVAS_BLANK'); process.exit(1); }
  if (!(moved > 5)) { console.error('PLAYER_DID_NOT_MOVE'); process.exit(1); }
  if (!(s1.clock !== s0.clock)) { console.error('CLOCK_FROZEN'); process.exit(1); }
  console.log('SMOKE_PASS');
} catch (e) { console.error(e); process.exit(1); }
finally { await browser?.close(); }
