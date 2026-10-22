import { describe, expect, it } from 'vitest';
import { posix, win32 } from 'node:path';
import { resolveAssetFile } from '../../scripts/assetPath.ts';

describe('Vite asset-path containment', () => {
  it('serves assets on POSIX and Windows without assuming slash style', () => {
    expect(resolveAssetFile('/project/assets', 'audio/menu.mp3', posix))
      .toBe('/project/assets/audio/menu.mp3');
    expect(resolveAssetFile('C:\\project\\assets', 'audio/menu.mp3', win32))
      .toBe('C:\\project\\assets\\audio\\menu.mp3');
  });

  it('rejects parent escapes, absolute paths and empty filenames', () => {
    expect(resolveAssetFile('/project/assets', '../private', posix)).toBeNull();
    expect(resolveAssetFile('C:\\project\\assets', '..\\private', win32)).toBeNull();
    expect(resolveAssetFile('C:\\project\\assets', 'C:\\private', win32)).toBeNull();
    expect(resolveAssetFile('/project/assets', '', posix)).toBeNull();
  });
});
