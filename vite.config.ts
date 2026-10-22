import { cpSync, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';

/**
 * The local audio/manifest live at the repo root `assets/`, but Vite's `publicDir`
 * copies a public directory's CONTENTS to the dist root (stripping the prefix). This
 * bridge serves `/assets/...` in dev and copies the folder to `dist/assets/` on build,
 * so the source of record and the served paths agree.
 */
const ASSETS = 'assets';
const CONTENT_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.json': 'application/json',
};
function assetsBridge(): Plugin {
  return {
    name: 'assets-bridge',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith(`/${ASSETS}/`)) return next();
        const relative = decodeURIComponent(url.slice(`/${ASSETS}/`.length).split('?')[0] ?? '');
        const file = normalize(join(ASSETS, relative));
        if (!file.startsWith(`${ASSETS}/`) || !existsSync(file) || !statSync(file).isFile()) {
          return next();
        }
        res.setHeader('Content-Type', CONTENT_TYPES[extname(file)] ?? 'application/octet-stream');
        res.end(readFileSync(file));
      });
    },
    closeBundle() {
      cpSync(ASSETS, 'dist/assets', { recursive: true });
    },
  };
}

// The app is published under a subpath on the static host, so the base path comes
// from the environment and defaults to '/' for local dev.
const fromEnv = process.env.TANK_BATTLE_BASE?.trim();
const base =
  fromEnv && fromEnv.length > 0
    ? fromEnv.endsWith('/')
      ? fromEnv
      : `${fromEnv}/`
    : '/';

export default defineConfig({
  root: '.',
  base,
  // The audio + manifest are bridged into `dist/assets/` by the assets plugin, so the
  // shipped URLs are `assets/audio/...` and `assets/manifest.json` while the source
  // of record stays at the repo root `assets/`.
  publicDir: 'public',
  plugins: [assetsBridge()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5176,
    open: false,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
});
