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
  if (await page.locator('#error').isVisible()) throw new Error('Title displayed error');
  await page.goto('http://127.0.0.1:4175/?mode=team&seed=2');
  await page.locator('#app').waitFor();
  await page.locator('#app').click({ position: { x: 300, y: 300 } });
  await page.keyboard.press('KeyW');
  await page.waitForTimeout(300);
  if (await page.locator('#error').isVisible()) throw new Error('Team displayed error');
  if (errors.length) throw new Error(errors.join('; '));
  console.log('Chromium smoke passed');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
