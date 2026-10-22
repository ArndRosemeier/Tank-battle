/**
 * The ONE audio seam. Web Audio only: a master bus, a music bus and an SFX bus, two
 * looping music beds with a 2 s crossfade, a duck for pause, and one-shot SFX.
 *
 * Browser law: an `AudioContext` cannot start before a user gesture. `unlock()` must be
 * called synchronously from a click/keydown handler; it creates and resumes the context
 * there, then loads the local manifest. Nothing is fetched from a CDN.
 *
 * The files and their provenance are `assets/manifest.json`; `assets.test.ts` pins the
 * file set both ways. The owner's ear chose the assets — the mapping below is reported.
 */

const CROSSFADE_SECONDS = 2;
const DUCK_FACTOR = 0.28;

export type MusicTrack = 'menu' | 'combat';

export type SfxName =
  | 'cannon'
  | 'hit'
  | 'death'
  | 'reload'
  | 'wall-break'
  | 'regen'
  | 'ui-click'
  | 'victory'
  | 'defeat';

export interface AudioVolumes {
  readonly master: number;
  readonly music: number;
  readonly sfx: number;
}

interface ManifestEntry {
  readonly path: string;
}

interface Manifest {
  readonly version: number;
  readonly entries: readonly ManifestEntry[];
}

interface PlayingMusic {
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
  readonly track: MusicTrack;
}

function clampVolume(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`audio: ${label} volume must be within 0…1, got ${String(value)}`);
  }
  return value;
}

function bufferKey(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.mp3$/, '');
}

export interface AudioEngineOptions {
  readonly onError: (error: unknown) => void;
  readonly volumes?: AudioVolumes;
}

export class AudioEngine {
  private readonly onError: (error: unknown) => void;
  private volumes: AudioVolumes;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private playing: PlayingMusic | null = null;
  private wantedTrack: MusicTrack | null = null;
  private unlocked = false;
  private loading: Promise<void> | null = null;
  private ducked = false;

  constructor(options: AudioEngineOptions) {
    this.onError = options.onError;
    this.volumes = options.volumes ?? { master: 0.8, music: 0.65, sfx: 0.8 };
    this.applyVolumes();
  }

  get isUnlocked(): boolean {
    return this.unlocked;
  }

  get loadedClipCount(): number {
    return this.buffers.size;
  }

  get contextState(): string {
    return this.context?.state ?? 'none';
  }

  /**
   * MUST be called from a real user gesture. Creates/resumes the context synchronously
   * before the first await, then decodes the local audio and starts the wanted track.
   */
  unlock(): void {
    if (this.unlocked) {
      void this.context?.resume();
      return;
    }
    try {
      const context = new AudioContext();
      this.context = context;
      this.master = context.createGain();
      this.musicBus = context.createGain();
      this.sfxBus = context.createGain();
      this.master.connect(context.destination);
      this.musicBus.connect(this.master);
      this.sfxBus.connect(this.master);
      this.applyVolumes();
      this.unlocked = true;
      void context.resume();
      this.loading = this.loadAll().then(() => {
        if (this.wantedTrack) this.playMusic(this.wantedTrack);
      });
      this.loading.catch((error) => this.onError(error));
    } catch (error) {
      this.onError(error);
    }
  }

  setVolumes(volumes: AudioVolumes): void {
    this.volumes = {
      master: clampVolume(volumes.master, 'master'),
      music: clampVolume(volumes.music, 'music'),
      sfx: clampVolume(volumes.sfx, 'sfx'),
    };
    this.applyVolumes();
  }

  setDucked(ducked: boolean): void {
    this.ducked = ducked;
    this.applyVolumes();
  }

  /** Starts (or crossfades to) a looping track. Safe to call before unlock. */
  playMusic(track: MusicTrack): void {
    this.wantedTrack = track;
    if (!this.context || !this.musicBus) return;
    const buffer = this.buffers.get(track);
    if (!buffer) return; // still loading; loadAll starts the wanted track
    if (this.playing?.track === track) return;
    this.startMusic(track, buffer);
  }

  playSfx(name: SfxName, gain = 1): void {
    const context = this.context;
    const bus = this.sfxBus;
    if (!context || !bus) return;
    const buffer = this.buffers.get(name);
    if (!buffer) return;
    if (!Number.isFinite(gain) || gain < 0 || gain > 4) {
      throw new Error(`audio: SFX gain must be within 0…4, got ${String(gain)}`);
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    const level = context.createGain();
    level.gain.value = gain;
    source.connect(level);
    level.connect(bus);
    source.start();
  }

  dispose(): void {
    const context = this.context;
    this.playing?.source.stop();
    this.playing = null;
    this.context = null;
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;
    this.unlocked = false;
    this.buffers.clear();
    if (context) void context.close();
  }

  private applyVolumes(): void {
    if (!this.context || !this.master || !this.musicBus || !this.sfxBus) return;
    const now = this.context.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, now, 0.03);
    this.sfxBus.gain.setTargetAtTime(this.volumes.sfx, now, 0.03);
    this.musicBus.gain.setTargetAtTime(
      this.volumes.music * (this.ducked ? DUCK_FACTOR : 1),
      now,
      0.08,
    );
  }

  private startMusic(track: MusicTrack, buffer: AudioBuffer): void {
    const context = this.context;
    const musicBus = this.musicBus;
    if (!context || !musicBus) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = context.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(musicBus);
    const now = context.currentTime;
    gain.gain.linearRampToValueAtTime(1, now + CROSSFADE_SECONDS);
    source.start();
    const previous = this.playing;
    if (previous) {
      previous.gain.gain.cancelScheduledValues(now);
      previous.gain.gain.setValueAtTime(previous.gain.gain.value, now);
      previous.gain.gain.linearRampToValueAtTime(0, now + CROSSFADE_SECONDS);
      window.setTimeout(() => {
        try {
          previous.source.stop();
        } catch {
          // Already stopped; stopping twice is a no-op.
        }
      }, CROSSFADE_SECONDS * 1000 + 50);
    }
    this.playing = { source, gain, track };
  }

  private async loadAll(): Promise<void> {
    const context = this.context;
    if (!context) throw new Error('audio: loadAll called before the context exists');
    const base = import.meta.env.BASE_URL;
    const response = await fetch(`${base}assets/manifest.json`);
    if (!response.ok) {
      throw new Error(`audio: assets/manifest.json answered ${response.status}`);
    }
    const manifest = (await response.json()) as Manifest;
    if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.entries)) {
      throw new Error('audio: assets/manifest.json is malformed');
    }
    await Promise.all(
      manifest.entries.map(async (entry) => {
        const audio = await fetch(`${base}${entry.path}`);
        if (!audio.ok) {
          throw new Error(`audio: ${entry.path} answered ${audio.status}`);
        }
        const data = await audio.arrayBuffer();
        const decoded = await context.decodeAudioData(data);
        this.buffers.set(bufferKey(entry.path), decoded);
      }),
    );
    for (const name of ['cannon', 'hit', 'death', 'reload', 'wall-break', 'regen', 'ui-click', 'victory', 'defeat', 'menu', 'combat']) {
      if (!this.buffers.has(name)) {
        throw new Error(`audio: required clip "${name}" is missing from assets/manifest.json`);
      }
    }
  }
}
