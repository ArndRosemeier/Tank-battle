import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TitleAudioGate } from './titleAudioGate.ts';

describe('the title first-gesture audio gate', () => {
  it('starts the menu loop on the first pointerdown and not again on a keydown', () => {
    const gate = new TitleAudioGate();
    expect(gate.pointerDown()).toBe('menu');
    expect(gate.unlocked).toBe(true);
    expect(gate.keyDown()).toBeNull();
    expect(gate.pointerDown()).toBeNull();
  });

  it('starts the menu loop on the first keydown and not again on a pointerdown', () => {
    const gate = new TitleAudioGate();
    expect(gate.keyDown()).toBe('menu');
    expect(gate.pointerDown()).toBeNull();
    expect(gate.keyDown()).toBeNull();
  });

  it('wires both gestures and disposes the background before a match boots', () => {
    const main = readFileSync(fileURLToPath(new URL('../main.ts', import.meta.url)), 'utf8');
    expect(main).toMatch(/titleGate\?\.pointerDown\(\)/);
    expect(main).toMatch(/titleGate\?\.keyDown\(\)/);
    expect(main).toContain("addEventListener('pointerdown', onPointer)");
    expect(main).toContain("addEventListener('keydown', onKey)");
    const disposeAt = main.indexOf('titleBackground.dispose()');
    const bootAt = main.indexOf('bootGame(launch, audio)');
    expect(disposeAt).toBeGreaterThan(-1);
    expect(bootAt).toBeGreaterThan(-1);
    expect(disposeAt).toBeLessThan(bootAt);
  });
});
