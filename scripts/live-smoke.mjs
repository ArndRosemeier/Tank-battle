#!/usr/bin/env node
/**
 * live-smoke.mjs — prove the DEPLOYED game actually loads and plays.
 *
 * `publish.sh` runs this against the public URL and FAILS the publish if it fails. The
 * point is the gap that produced two live outages: a green local gate and a content check
 * on the entry HTML said nothing about whether the page BOOTS. This loads the page like a
 * visitor, collects every console error and every HTTP >= 400, checks the asset tree the
 * app asks for, and clicks Play once.
 *
 * Usage: node scripts/live-smoke.mjs [url]
 *
 * Exit: 0 = loaded, no errors, a mode started; 1 = anything wrong (the reason is printed).
 *
 * Playwright is a DEV-ONLY, gitignored install (`.browser-smoke/`), and this drives the
 * system Chrome — no bundled browser download. If it is missing, this exits 2 with the
 * install command, and `publish.sh` treats 2 as "not verified" rather than success.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const URL_TO_CHECK = process.argv[2] ?? 'https://apps.futuremagic.de/tank-battle/';
const PLAYWRIGHT_DIR = resolve('.browser-smoke/node_modules/playwright');
const CHROME = process.env.CHROME_BIN ?? '/usr/bin/google-chrome';

if (!existsSync(PLAYWRIGHT_DIR)) {
  console.error(
    'live-smoke: playwright is not installed locally.\n' +
      '  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --prefix .browser-smoke --no-save playwright@1.58.2',
  );
  process.exit(2);
}
if (!existsSync(CHROME)) {
  console.error(`live-smoke: no Chrome at ${CHROME} (set CHROME_BIN)`);
  process.exit(2);
}

const { chromium } = await import(pathToFileURL(resolve(PLAYWRIGHT_DIR, 'index.mjs')).href);

const problems = [];
const requests = new Map();

function note(what) {
  problems.push(what);
  console.error(`live-smoke: FAIL — ${what}`);
}

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: CHROME,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  page.on('pageerror', (error) => note(`page error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') note(`console error: ${message.text()}`);
  });
  page.on('requestfailed', (request) =>
    note(`request failed: ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`),
  );
  page.on('response', (response) => {
    requests.set(response.url(), response.status());
    if (response.status() >= 400) note(`HTTP ${response.status()}: ${response.url()}`);
  });

  console.log(`live-smoke: loading ${URL_TO_CHECK}`);
  await page.goto(URL_TO_CHECK, { waitUntil: 'load', timeout: 30000 });

  // The title must actually appear. A blank page and a dead bundle both fail here.
  await page.waitForSelector('#title-play', { state: 'attached', timeout: 20000 });
  const titleText = (await page.locator('#title-screen').innerText().catch(() => '')) ?? '';
  if (!/TANK BATTLE/i.test(titleText)) note('the title screen does not show the wordmark');
  if (await page.locator('#error').isVisible().catch(() => false)) {
    note(`the app error surface is visible: ${(await page.locator('#error').innerText()).slice(0, 200)}`);
  }

  // The battle behind the title must be animating: two real-time frames, compared by hash,
  // because one still frame proves nothing about motion.
  const shotA = await page.screenshot();
  await page.waitForTimeout(1200);
  const shotB = await page.screenshot();
  if (Buffer.compare(shotA, shotB) === 0) note('the title background is static (two frames are identical)');

  // Click Play like a visitor would.
  await page.locator('#title-play').click({ timeout: 10000 });
  await page.waitForTimeout(1500);
  const playVisible = await page.locator('#app').isVisible().catch(() => false);
  if (!playVisible) note('Play did not open the game canvas');
  const titleGone = !(await page.locator('#title-screen').isVisible().catch(() => false));
  if (!titleGone) note('the title screen is still covering the game after Play');

  // AIM DIRECTION, end to end, on the deployed build. The owner found this inverted once
  // (pointer left swung the turret right), and unit pins only cover the two halves of the
  // chain. Move the pointer to the right quarter, then the left quarter, and require the
  // projected reticle to move right with it.
  const size = page.viewportSize() ?? { width: 1280, height: 800 };
  const reticleX = async () => {
    const box = await page.locator('#aim-reticle').boundingBox().catch(() => null);
    if (!box) return null;
    return box.x + box.width / 2;
  };
  await page.mouse.move(Math.round(size.width * 0.75), Math.round(size.height * 0.5));
  await page.waitForTimeout(500);
  const aimRight = await reticleX();
  await page.mouse.move(Math.round(size.width * 0.25), Math.round(size.height * 0.5));
  await page.waitForTimeout(500);
  const aimLeft = await reticleX();
  if (aimRight === null || aimLeft === null) {
    note('the aim reticle is not visible, so aim direction could not be checked');
  } else if (!(aimRight > aimLeft + 40)) {
    note(`aim is INVERTED or unresponsive: pointer right -> reticle x ${Math.round(aimRight)}, pointer left -> ${Math.round(aimLeft)}`);
  }

  // The audio assets the page asks for must exist.
  for (const path of ['assets/manifest.json', 'assets/audio/menu.mp3']) {
    const url = new URL(path, URL_TO_CHECK).href;
    const response = await fetch(url).catch(() => null);
    if (!response || !response.ok) note(`${path} is not reachable (${response?.status ?? 'no response'})`);
  }

  if (problems.length === 0) {
    console.log('live-smoke: PASS — page booted, no console/HTTP errors, Play opened the game');
  }
  process.exitCode = problems.length === 0 ? 0 : 1;
} catch (error) {
  note(`the smoke itself failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
}
