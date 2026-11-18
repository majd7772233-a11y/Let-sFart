import type { EmoteId, PickupKind } from '../shared/types.ts';

interface ActiveFartVoice {
  osc: OscillatorNode;
  subOsc: OscillatorNode;
  lfo: OscillatorNode;
  lfoGain: GainNode;
  noise?: AudioBufferSourceNode;
  noiseGain: GainNode;
  masterGain: GainNode;
  filter: BiquadFilterNode;
  stopTimer?: number;
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private sfxGain: GainNode | null = null;
  private voiceGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private fartVoices = new Map<number, ActiveFartVoice>();

  private sfxVolume = 0.8;
  private voiceVolume = 0.85;
  private musicVolume = 0.35;
  private sfxMuted = false;
  private voiceMuted = false;
  private musicMuted = false;
  private musicTimer: number | null = null;
  private musicStep = 0;
  private lastVoiceAtMs = new Map<string, number>();

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.sfxGain = this.ctx.createGain();
      this.voiceGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      this.sfxGain.connect(this.ctx.destination);
      this.voiceGain.connect(this.ctx.destination);
      this.musicGain.connect(this.ctx.destination);
      this.applyVolumes();
      this.noiseBuffer = this.createNoiseBuffer(this.ctx);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = ctx.sampleRate * 1.5;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.04 * white) / 1.04;
      data[i] = lastOut * 2.5 + white * 0.25;
    }
    return buffer;
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.sfxGain || !this.musicGain) return;
    const now = this.ctx.currentTime;
    this.sfxGain.gain.setTargetAtTime(this.sfxMuted ? 0 : this.sfxVolume, now, 0.02);
    if (this.voiceGain) {
      this.voiceGain.gain.setTargetAtTime(this.voiceMuted ? 0 : this.voiceVolume, now, 0.02);
    }
    this.musicGain.gain.setTargetAtTime(this.musicMuted ? 0 : this.musicVolume, now, 0.04);
  }

  public unlock(): void {
    this.ensureContext();
  }

  public setSettings(opts: {
    sfxVolume?: number;
    voiceVolume?: number;
    musicVolume?: number;
    sfxMuted?: boolean;
    voiceMuted?: boolean;
    musicMuted?: boolean;
  }): void {
    if (opts.sfxVolume !== undefined) this.sfxVolume = Math.max(0, Math.min(1, opts.sfxVolume));
    if (opts.voiceVolume !== undefined) this.voiceVolume = Math.max(0, Math.min(1, opts.voiceVolume));
    if (opts.musicVolume !== undefined) this.musicVolume = Math.max(0, Math.min(1, opts.musicVolume));
    if (opts.sfxMuted !== undefined) this.sfxMuted = opts.sfxMuted;
    if (opts.voiceMuted !== undefined) this.voiceMuted = opts.voiceMuted;
    if (opts.musicMuted !== undefined) this.musicMuted = opts.musicMuted;
    this.applyVolumes();
  }

  public getSettings() {
    return {
      sfxVolume: this.sfxVolume,
      voiceVolume: this.voiceVolume,
      musicVolume: this.musicVolume,
      sfxMuted: this.sfxMuted,
      voiceMuted: this.voiceMuted,
      musicMuted: this.musicMuted,
    };
  }

  public updateFartVoice(slot: number, active: boolean, power: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxGain || this.sfxMuted) {
      if (!active) this.stopFartVoice(slot);
      return;
    }

    if (!active) {
      if (this.fartVoices.has(slot)) {
        this.stopFartVoice(slot);
      }
      return;
    }

    let voice = this.fartVoices.get(slot);
    const now = ctx.currentTime;
    if (!voice) {
      // Create multi-layered comic fart voice
      const osc = ctx.createOscillator();
      const subOsc = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      const masterGain = ctx.createGain();
      const noiseGain = ctx.createGain();

      // Slight per-character pitch personality
      const pitchOffset = (slot - 1.5) * 6;
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(52 + pitchOffset, now);

      subOsc.type = 'triangle';
      subOsc.frequency.setValueAtTime(34 + pitchOffset * 0.5, now);

      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(22, now);
      lfoGain.gain.setValueAtTime(18, now);
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);

      filter.type = 'lowpass';
      filter.Q.setValueAtTime(4.5, now);
      filter.frequency.setValueAtTime(280, now);

      masterGain.gain.setValueAtTime(0.001, now);
      masterGain.gain.linearRampToValueAtTime(0.18, now + 0.035);

      osc.connect(filter);
      subOsc.connect(filter);

      let noise: AudioBufferSourceNode | undefined;
      if (this.noiseBuffer) {
        noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        noise.loop = true;
        noiseGain.gain.setValueAtTime(0.08, now);
        noise.connect(noiseGain);
        noiseGain.connect(filter);
        noise.start(now);
      }

      filter.connect(masterGain);
      masterGain.connect(this.sfxGain);

      osc.start(now);
      subOsc.start(now);
      lfo.start(now);

      voice = { osc, subOsc, lfo, lfoGain, noise, noiseGain, masterGain, filter };
      this.fartVoices.set(slot, voice);
    }

    // Modulate intensity smoothly as press continues
    const pitchBase = 48 + (slot - 1.5) * 6 + power * 42;
    voice.osc.frequency.setTargetAtTime(pitchBase, now, 0.04);
    voice.subOsc.frequency.setTargetAtTime(pitchBase * 0.62, now, 0.04);
    voice.lfo.frequency.setTargetAtTime(18 + power * 28, now, 0.05);
    voice.lfoGain.gain.setTargetAtTime(14 + power * 26, now, 0.05);
    voice.filter.frequency.setTargetAtTime(240 + power * 680, now, 0.04);
    voice.noiseGain.gain.setTargetAtTime(0.06 + power * 0.24, now, 0.04);
    voice.masterGain.gain.setTargetAtTime(0.12 + power * 0.2, now, 0.04);
  }

  private cleanupVoiceNodes(voice: ActiveFartVoice): void {
    const safeStop = (node?: AudioScheduledSourceNode) => {
      if (!node) return;
      try {
        node.stop();
      } catch {
        // already stopped
      }
    };
    const safeDisconnect = (node?: AudioNode) => {
      if (!node) return;
      try {
        node.disconnect();
      } catch {
        // already disconnected
      }
    };

    safeStop(voice.osc);
    safeStop(voice.subOsc);
    safeStop(voice.lfo);
    safeStop(voice.noise);

    safeDisconnect(voice.osc);
    safeDisconnect(voice.subOsc);
    safeDisconnect(voice.lfo);
    safeDisconnect(voice.lfoGain);
    safeDisconnect(voice.noise);
    safeDisconnect(voice.noiseGain);
    safeDisconnect(voice.filter);
    safeDisconnect(voice.masterGain);
  }

  public stopFartVoice(slot: number, immediate = false): void {
    const voice = this.fartVoices.get(slot);
    if (!voice) return;
    this.fartVoices.delete(slot);

    if (voice.stopTimer !== undefined) {
      window.clearTimeout(voice.stopTimer);
      voice.stopTimer = undefined;
    }

    if (immediate || !this.ctx) {
      this.cleanupVoiceNodes(voice);
      return;
    }

    const now = this.ctx.currentTime;
    // Play natural comic release tail rather than abrupt cutoff
    voice.osc.frequency.setTargetAtTime(34, now, 0.04);
    voice.masterGain.gain.setTargetAtTime(0.0001, now, 0.045);
    voice.stopTimer = window.setTimeout(() => {
      voice.stopTimer = undefined;
      this.cleanupVoiceNodes(voice);
    }, 160);
  }

  public stopAllFarts(immediate = false): void {
    for (const slot of Array.from(this.fartVoices.keys())) {
      this.stopFartVoice(slot, immediate);
    }
  }

  public playCollision(intensity = 0.5): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain || this.sfxMuted) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    const startFreq = 140 + (Math.random() - 0.5) * 24;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.14);

    gain.gain.setValueAtTime(0.28 * intensity, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.17);
  }

  public playBumper(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain || this.sfxMuted) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(580, now + 0.09);
    osc.frequency.exponentialRampToValueAtTime(260, now + 0.24);
    gain.gain.setValueAtTime(0.32, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.27);
  }

  public playHazardHit(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain || this.sfxMuted) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(46, now + 0.26);
    gain.gain.setValueAtTime(0.34, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  public playSurfaceCrack(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain || this.sfxMuted) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(920, now);
    osc.frequency.exponentialRampToValueAtTime(260, now + 0.11);
    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.13);
  }

  public playSurfaceBreak(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain || this.sfxMuted) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(85, now + 0.25);
    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  public playFall(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain || this.sfxMuted) return;
    const now = ctx.currentTime;

    // Cartoon whistle drop
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(760, now);
    osc.frequency.exponentialRampToValueAtTime(160, now + 0.52);
    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.56);

    // Water splash noise burst
    if (this.noiseBuffer) {
      const splash = ctx.createBufferSource();
      splash.buffer = this.noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(900, now + 0.2);
      const nGain = ctx.createGain();
      nGain.gain.setValueAtTime(0.001, now);
      nGain.gain.linearRampToValueAtTime(0.32, now + 0.26);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.72);
      splash.connect(filter);
      filter.connect(nGain);
      nGain.connect(this.sfxGain);
      splash.start(now);
      splash.stop(now + 0.75);
    }
  }

  public playCheckpoint(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain || this.sfxMuted) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    const now = ctx.currentTime;
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t = now + idx * 0.07;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.22, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.connect(gain);
      gain.connect(this.sfxGain!);
      osc.start(t);
      osc.stop(t + 0.27);
    });
  }

  public playVictory(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain || this.sfxMuted) return;
    const melody = [
      { f: 523.25, d: 0.12, t: 0 },
      { f: 659.25, d: 0.12, t: 0.12 },
      { f: 783.99, d: 0.12, t: 0.24 },
      { f: 1046.5, d: 0.36, t: 0.36 },
      { f: 880, d: 0.12, t: 0.56 },
      { f: 1046.5, d: 0.45, t: 0.7 },
    ];
    const now = ctx.currentTime;
    for (const n of melody) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const start = now + n.t;
      osc.frequency.setValueAtTime(n.f, start);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + n.d);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(start);
      osc.stop(start + n.d + 0.02);
    }
  }

  public playPickup(kind?: PickupKind): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain || this.sfxMuted) return;
    const now = ctx.currentTime;
    const isTopCan = kind === 'lentil_can';
    const notes = isTopCan ? [587.33, 783.99, 1046.5, 1318.5] : [523.25, 659.25, 880];
    notes.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t = now + idx * 0.05;
      osc.frequency.setValueAtTime(f, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.22, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.connect(gain);
      gain.connect(this.sfxGain!);
      osc.start(t);
      osc.stop(t + 0.22);
    });
  }

  public playShieldBlock(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain || this.sfxMuted) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(640, now);
    osc.frequency.exponentialRampToValueAtTime(240, now + 0.22);
    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  public playShieldBreak(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain || this.sfxMuted) return;
    const now = ctx.currentTime;
    [880, 620, 310].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      const t = now + i * 0.04;
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(110, t + 0.14);
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      osc.connect(gain);
      gain.connect(this.sfxGain!);
      osc.start(t);
      osc.stop(t + 0.17);
    });
  }

  public playRepair(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain || this.sfxMuted) return;
    const now = ctx.currentTime;
    [440, 554.37, 659.25, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = i < 2 ? 'square' : 'triangle';
      const t = now + i * 0.055;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(i < 2 ? 0.12 : 0.2, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(gain);
      gain.connect(this.sfxGain!);
      osc.start(t);
      osc.stop(t + 0.2);
    });
  }

  public playAnchor(dropped: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain || this.sfxMuted) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(dropped ? 210 : 120, now);
    osc.frequency.exponentialRampToValueAtTime(dropped ? 65 : 280, now + 0.18);
    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  public playShockwave(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain || this.sfxMuted) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(340, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.38);
    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.44);
  }

  public playSuperFart(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain || this.sfxMuted) return;
    const now = ctx.currentTime;
    [130.81, 196.0, 261.63, 392.0].forEach((freq) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.35, now + 0.45);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.14, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
      osc.connect(gain);
      gain.connect(this.sfxGain!);
      osc.start(now);
      osc.stop(now + 0.58);
    });
  }

  public playLightning(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain || this.sfxMuted || !this.noiseBuffer) return;
    const now = ctx.currentTime;
    const thunder = ctx.createBufferSource();
    thunder.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(950, now);
    filter.frequency.exponentialRampToValueAtTime(110, now + 1.1);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.36, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.25);
    thunder.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    thunder.start(now);
    thunder.stop(now + 1.3);
  }

  public playCoin(isChest = false): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain || this.sfxMuted) return;
    const now = ctx.currentTime;
    const notes = isChest
      ? [659.25, 783.99, 987.77, 1318.51, 1567.98]
      : [987.77, 1318.51];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = isChest ? 'triangle' : 'sine';
      const t = now + idx * 0.045;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(isChest ? 0.24 : 0.18, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, t + (isChest ? 0.24 : 0.16));
      osc.connect(gain);
      gain.connect(this.sfxGain!);
      osc.start(t);
      osc.stop(t + (isChest ? 0.26 : 0.18));
    });
  }

  public playChaosShift(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain || this.sfxMuted) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(740, now + 0.18);
    osc.frequency.exponentialRampToValueAtTime(280, now + 0.42);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.24, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.46);
  }

  public playChatPop(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain || this.sfxMuted) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.exponentialRampToValueAtTime(980, now + 0.065);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.095);
  }

  public playEmote(emoteId: EmoteId): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain || this.sfxMuted) return;
    const now = ctx.currentTime;

    const noteSets: Record<EmoteId, { freqs: number[]; step: number; wave: OscillatorType }> = {
      laugh: { freqs: [523.25, 659.25, 587.33, 698.46, 783.99], step: 0.065, wave: 'triangle' },
      fear: { freqs: [622.25, 554.37, 466.16, 392.0], step: 0.06, wave: 'sawtooth' },
      celebrate: { freqs: [523.25, 659.25, 783.99, 1046.5], step: 0.06, wave: 'triangle' },
      dance: { freqs: [440, 523.25, 659.25, 587.33, 659.25, 783.99], step: 0.07, wave: 'sine' },
      point_left: { freqs: [587.33, 493.88], step: 0.065, wave: 'sine' },
      point_right: { freqs: [493.88, 659.25], step: 0.065, wave: 'sine' },
    };
    const cfg = noteSets[emoteId] ?? noteSets.celebrate;
    cfg.freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = cfg.wave;
      const t = now + idx * cfg.step;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(cfg.wave === 'sawtooth' ? 0.11 : 0.18, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
      osc.connect(gain);
      gain.connect(this.sfxGain!);
      osc.start(t);
      osc.stop(t + 0.15);
    });
  }

  public playCharacterReaction(
    kind: 'collision' | 'fear' | 'victory' | 'powerup' | 'fall' | 'anchor',
    slot = 0,
  ): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.voiceGain || this.voiceMuted || this.voiceVolume <= 0.01) return;

    const nowMs = performance.now();
    const cooldownMs =
      kind === 'victory' ? 400 : kind === 'powerup' ? 500 : kind === 'fall' ? 750 : 950;
    const prevMs = this.lastVoiceAtMs.get(kind) ?? 0;
    if (nowMs - prevMs < cooldownMs) return;
    this.lastVoiceAtMs.set(kind, nowMs);

    const now = ctx.currentTime;
    const voicePitch = [1.0, 0.86, 1.16, 1.32][Math.abs(slot) % 4];

    const formant = ctx.createBiquadFilter();
    formant.type = 'bandpass';
    formant.Q.setValueAtTime(3.2, now);
    formant.frequency.setValueAtTime(880 * voicePitch, now);
    formant.connect(this.voiceGain);

    if (kind === 'collision') {
      // Comedic "Ouch!" double syllable cartoon blip
      [0, 0.09].forEach((offset, idx) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'triangle';
        const t = now + offset;
        const f0 = (idx === 0 ? 520 : 370) * voicePitch;
        osc.frequency.setValueAtTime(f0, t);
        osc.frequency.exponentialRampToValueAtTime(f0 * 0.56, t + 0.085);
        g.gain.setValueAtTime(0.001, t);
        g.gain.linearRampToValueAtTime(0.28, t + 0.014);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        osc.connect(g);
        g.connect(formant);
        osc.start(t);
        osc.stop(t + 0.11);
      });
    } else if (kind === 'fear') {
      // Shaky cartoon "Yikes!" vibrato whimper
      const osc = ctx.createOscillator();
      const vib = ctx.createOscillator();
      const vibGain = ctx.createGain();
      const g = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(640 * voicePitch, now);
      osc.frequency.exponentialRampToValueAtTime(420 * voicePitch, now + 0.26);
      vib.type = 'sine';
      vib.frequency.setValueAtTime(26, now);
      vibGain.gain.setValueAtTime(34, now);
      vib.connect(vibGain);
      vibGain.connect(osc.frequency);
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(0.18, now + 0.025);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc.connect(g);
      g.connect(formant);
      osc.start(now);
      vib.start(now);
      osc.stop(now + 0.3);
      vib.stop(now + 0.3);
    } else if (kind === 'victory') {
      // Joyful cartoon "Yee-haw / Woo-hoo!" celebratory chirp
      const seq = [
        { t: 0, f0: 440, f1: 680, d: 0.11 },
        { t: 0.11, f0: 587, f1: 880, d: 0.12 },
        { t: 0.24, f0: 784, f1: 1175, d: 0.24 },
      ];
      seq.forEach((n) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'triangle';
        const t = now + n.t;
        osc.frequency.setValueAtTime(n.f0 * voicePitch, t);
        osc.frequency.exponentialRampToValueAtTime(n.f1 * voicePitch, t + n.d);
        g.gain.setValueAtTime(0.001, t);
        g.gain.linearRampToValueAtTime(0.24, t + 0.018);
        g.gain.exponentialRampToValueAtTime(0.001, t + n.d);
        osc.connect(g);
        g.connect(formant);
        osc.start(t);
        osc.stop(t + n.d + 0.02);
      });
    } else if (kind === 'powerup') {
      // Energetic "Let's go!" rising vocal pop
      [392, 587.33, 783.99].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'triangle';
        const t = now + idx * 0.055;
        osc.frequency.setValueAtTime(freq * voicePitch, t);
        osc.frequency.exponentialRampToValueAtTime(freq * 1.18 * voicePitch, t + 0.09);
        g.gain.setValueAtTime(0.001, t);
        g.gain.linearRampToValueAtTime(0.22, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
        osc.connect(g);
        g.connect(formant);
        osc.start(t);
        osc.stop(t + 0.12);
      });
    } else if (kind === 'fall') {
      // Comedic downward "Waaah!" cartoon voice slide
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(720 * voicePitch, now);
      osc.frequency.exponentialRampToValueAtTime(195 * voicePitch, now + 0.44);
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(0.24, now + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.46);
      osc.connect(g);
      g.connect(formant);
      osc.start(now);
      osc.stop(now + 0.48);
    } else {
      // Anchor brace "Hmph!"
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(240 * voicePitch, now);
      osc.frequency.exponentialRampToValueAtTime(145 * voicePitch, now + 0.11);
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(0.22, now + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
      osc.connect(g);
      g.connect(formant);
      osc.start(now);
      osc.stop(now + 0.14);
    }
  }

  public startMusic(): void {
    if (this.musicTimer !== null) return;
    const scale = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25];
    const pattern = [0, 2, 3, 2, 4, 3, 2, 1, 0, 2, 4, 5, 4, 3, 2, 1];
    this.musicTimer = window.setInterval(() => {
      if (!this.ctx || !this.musicGain || this.musicMuted || this.musicVolume <= 0.01) return;
      if (this.ctx.state !== 'running') return;
      const now = this.ctx.currentTime;
      const note = scale[pattern[this.musicStep % pattern.length]];
      this.musicStep += 1;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(note, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.09, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      osc.connect(gain);
      gain.connect(this.musicGain);
      osc.start(now);
      osc.stop(now + 0.25);
    }, 260);
  }

  public stopMusic(): void {
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  public dispose(): void {
    this.stopAllFarts(true);
    this.stopMusic();
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}
