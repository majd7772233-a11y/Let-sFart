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
  private musicGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private fartVoices = new Map<number, ActiveFartVoice>();

  private sfxVolume = 0.8;
  private musicVolume = 0.35;
  private sfxMuted = false;
  private musicMuted = false;
  private musicTimer: number | null = null;
  private musicStep = 0;

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.sfxGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      this.sfxGain.connect(this.ctx.destination);
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
    this.musicGain.gain.setTargetAtTime(this.musicMuted ? 0 : this.musicVolume, now, 0.04);
  }

  public unlock(): void {
    this.ensureContext();
  }

  public setSettings(opts: {
    sfxVolume?: number;
    musicVolume?: number;
    sfxMuted?: boolean;
    musicMuted?: boolean;
  }): void {
    if (opts.sfxVolume !== undefined) this.sfxVolume = Math.max(0, Math.min(1, opts.sfxVolume));
    if (opts.musicVolume !== undefined) this.musicVolume = Math.max(0, Math.min(1, opts.musicVolume));
    if (opts.sfxMuted !== undefined) this.sfxMuted = opts.sfxMuted;
    if (opts.musicMuted !== undefined) this.musicMuted = opts.musicMuted;
    this.applyVolumes();
  }

  public getSettings() {
    return {
      sfxVolume: this.sfxVolume,
      musicVolume: this.musicVolume,
      sfxMuted: this.sfxMuted,
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
