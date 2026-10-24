/**
 * Run after pnpm build and npm install --prefix .browser-smoke --no-save playwright.
 * The browser smoke is optional locally; it uses a real Chromium browser.
 */
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const { chromium } = await import(pathToFileURL(resolve('.browser-smoke/node_modules/playwright/index.mjs')).href);
const server = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4175', '--strictPort'], { stdio: 'ignore' });
let browser;
try {
  let ready = false;
  for (let tries = 0; tries < 60; tries++) {
    if (server.exitCode !== null) throw new Error('Preview exited early');
    try { ready = (await fetch('http://127.0.0.1:4175/')).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('Preview never started');
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4175/?mode=title');
  await page.locator('#title-canvas').waitFor({ state: 'attached' });
  await page.locator('#title-settings').click();
  if (!(await page.locator('#settings-screen').isVisible())) throw new Error('Title settings did not open');
  await page.locator('#settings-motion').click();
  await page.locator('#settings-back').click();
  if (await page.locator('#settings-screen').isVisible()) throw new Error('Settings did not close');
  await page.locator('#title-play').click();
  if (!(await page.locator('#app').isVisible())) throw new Error('Play mode failed to launch');
  await page.keyboard.press('Escape');
  if (!(await page.locator('#pause-screen').isVisible())) throw new Error('Pause did not open');
  await page.locator('#pause-settings').click();
  if (!(await page.locator('#settings-screen').isVisible())) throw new Error('Pause settings did not open');
  await page.locator('#settings-back').click();
  await page.locator('#pause-resume').click();
  if (await page.locator('#pause-screen').isVisible()) throw new Error('Resume failed');
  if (await page.locator('#error').isVisible()) throw new Error('Title displayed error');
  await page.goto('http://127.0.0.1:4175/?mode=team&seed=2');
  await page.locator('#app').waitFor();
  await page.locator('#app').click({ position: { x: 300, y: 300 } });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(300);
  await page.keyboard.up('KeyW');
  await page.setViewportSize({ width: 900, height: 650 });
  await page.keyboard.press('Escape');
  if (!(await page.locator('#pause-screen').isVisible())) throw new Error('Team pause failed');
  await page.locator('#pause-resume').click();
  await page.goto('http://127.0.0.1:4175/?mode=spectate&teams=2&tanksPerTeam=2');
  await page.locator('#app').waitFor();
  await page.keyboard.press('KeyN');
  await page.keyboard.press('KeyA');
  if (await page.locator('#error').isVisible()) throw new Error('Spectator emitted error');
  // The procedural arena: type a seed, grow the size, deploy, and the link reproduces it.
  await page.goto('http://127.0.0.1:4175/?mode=title');
  await page.locator('#title-setup').click();
  await page.locator('[data-setup-arena="generated"]').click();
  if (!(await page.locator('#setup-arena-seed').isVisible())) throw new Error('Arena seed field did not appear');
  await page.locator('#setup-arena-seed').fill('12x');
  if (!(await page.locator('#setup-start').isDisabled())) throw new Error('START allowed an invalid arena seed');
  await page.locator('#setup-arena-seed').fill('4242');
  await page.locator('[data-arena-size-step="1"]').click();
  await page.locator('#setup-start').click();
  await page.locator('#app').waitFor();
  const arenaUrl = new URL(page.url());
  if (arenaUrl.searchParams.get('arena') !== 'generated' || arenaUrl.searchParams.get('arenaSeed') !== '4242' || arenaUrl.searchParams.get('arenaSize') !== 'large') {
    throw new Error(`Generated arena not in the URL: ${page.url()}`);
  }
  if (await page.locator('#error').isVisible()) throw new Error('Generated arena displayed error');
  if (await page.locator('#error').isVisible()) throw new Error('Team displayed error');
  if (errors.length) throw new Error(errors.join('; '));
  console.log('Chromium smoke passed');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
