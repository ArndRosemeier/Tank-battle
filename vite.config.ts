import { cpSync, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { resolveAssetFile } from './scripts/assetPath.ts';
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
let outDir = resolve("dist");

function assetsBridge(): Plugin {
  return {
    name: 'assets-bridge',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith(`/${ASSETS}/`)) return next();
        let relative: string;
        try {
          relative = decodeURIComponent(url.slice(`/${ASSETS}/`.length).split('?')[0] ?? '');
        } catch {
          res.statusCode = 400;
          res.end('Malformed asset URL');
          return;
        }
        const file = resolveAssetFile(ASSETS, relative);
        if (file === null || !existsSync(file) || !statSync(file).isFile()) {
          return next();
        }
        res.setHeader('Content-Type', CONTENT_TYPES[extname(file)] ?? 'application/octet-stream');
        res.end(readFileSync(file));
      });
    },
    // Follow the build's REAL output directory. `publish.sh` stages into
    // `.gate-logs/publish-dist`, so a hardcoded `dist/assets` shipped a build with no
    // audio and no manifest (the public page then 404'd `assets/manifest.json` and was
    // silent). `--outDir` and this seam must agree or the publish is incomplete.
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      cpSync(ASSETS, join(outDir, 'assets'), { recursive: true });
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
