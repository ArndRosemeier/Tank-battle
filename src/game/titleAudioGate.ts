/**
 * The title's first-gesture gate. Browser autoplay law requires a real gesture to start
 * audio; the first pointerdown OR keydown anywhere on the title should start the menu
 * loop, and later gestures must not restart it. This module is the pinned state machine;
 * `main.ts` wires `pointerdown` and `keydown` to `firstGesture()`.
 */

export type TitleGestureTrack = 'menu';

export class TitleAudioGate {
  private started = false;

  /** Returns `'menu'` exactly once (the first gesture); `null` afterwards. */
  firstGesture(): TitleGestureTrack | null {
    if (this.started) return null;
    this.started = true;
    return 'menu';
  }

  /** The `pointerdown` entry point. */
  pointerDown(): TitleGestureTrack | null {
    return this.firstGesture();
  }

  /** The `keydown` entry point. */
  keyDown(): TitleGestureTrack | null {
    return this.firstGesture();
  }

  get unlocked(): boolean {
    return this.started;
  }
}
