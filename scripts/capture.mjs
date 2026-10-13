// scripts/capture.mjs — Playwright capture helper (called by capture.sh).
// Exits 75 on transient navigation/browser infra failures, 1 on script/rendering defects.
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const url = process.env.CAPTURE_URL;
const output = process.env.CAPTURE_DIR;
if (!url || !output) {
  console.error('Set CAPTURE_URL and CAPTURE_DIR.');
  process.exit(1);
}
mkdirSync(output, { recursive: true });

const runtime = join(process.env.HOME, '.local/share/omgithub-playwright');
const req = createRequire(join(runtime, 'node_modules', 'playwright', 'package.json'));
const { chromium } = req('playwright');

let config = { browser: { launchOptions: { channel: 'chromium', headless: false, args: [] } } };
try {
  config = JSON.parse(readFileSync(join(runtime, 'linux.json'), 'utf8'));
} catch (err) {
  console.error(`Cannot read playwright config: ${err.message}`);
  process.exit(1);
}
if (process.platform === 'linux') {
  try {
    process.env.DISPLAY ||= ':' + readFileSync(join(runtime, 'display'), 'utf8').trim();
  } catch (err) {
    console.error(`Cannot read X display: ${err.message}`);
    process.exit(75);
  }
}

const transientStatus = new Set([408, 429, 500, 502, 503, 504]);
const transient = (err) => { throw Object.assign(err instanceof Error ? err : new Error(String(err)), { exitCode: 75 }); };

let browser;
try {
  browser = await chromium.launch({ ...config.browser.launchOptions, timeout: 30000 }).catch(transient);
  for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } }).catch(transient);
    page.setDefaultTimeout(30000);
    page.on('pageerror', (e) => console.error(e.message));
    const response = await page.goto(url, { waitUntil: 'load', timeout: 45000 }).catch(transient);
    if (!response?.ok()) {
      const status = response?.status();
      throw Object.assign(new Error(`HTTP ${status} loading preview`), {
        exitCode: !response || transientStatus.has(status) ? 75 : 1,
      });
    }
    await page.locator('body').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.fonts.status === 'loaded');
    await page.waitForTimeout(1000);
    const hasContent = await page.evaluate(() => (document.body?.innerText || '').trim().length > 0);
    if (!hasContent) throw Object.assign(new Error('Rendered page has no text content'), { exitCode: 1 });
    await page.screenshot({ path: join(output, `final-${name}.png`), timeout: 30000 }).catch((error) => {
      if (error.name === 'TimeoutError' || !browser.isConnected()) transient(error);
      throw error;
    });
    console.log(`Captured final-${name}.png (${width}x${height})`);
    await page.close();
  }
} catch (error) {
  console.error(error);
  process.exitCode = error.exitCode || 1;
} finally {
  await browser?.close().catch((error) => { console.error(error); process.exitCode ||= 75; });
}
