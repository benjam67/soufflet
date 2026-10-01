// Musique de combat façon générique d'anime 90s, synthétisée en code (Web Audio).
// Rock rapide en do majeur sur l'enchaînement « royal road » (Fa – Sol – Mi m – La m) des génériques japonais :
// guitare saturée, basse qui pompe, mélodie en dents de scie avec vibrato et écho, arpège, batterie, réverbération.

const BPM = 156;
/** Durée d'une double croche (1/16 de mesure), en secondes. */
export const STEP = 60 / BPM / 4;

type Chord = { root: number; notes: number[] };
/** Note de mélodie : [pas de départ (0–15), note MIDI, durée en pas]. */
type Note = [number, number, number];

// Notes MIDI : C4 = 60
const C = (root: number, third: number, fifth: number): Chord => ({ root, notes: [root, third, fifth] });
const Am = C(57, 60, 64);
const F = C(53, 57, 60);
const G = C(55, 59, 62);
const Cmaj = C(48, 52, 55);
const Em = C(52, 55, 59);
const E = C(52, 56, 59); // mi majeur : tension avant de revenir sur la mineur

type Section = 'intro' | 'verse' | 'chorus';
interface Bar {
  section: Section;
  chord: Chord;
  lead: Note[];
  /** Roulement de caisse claire en fin de mesure. */
  fill?: boolean;
  /** Cymbale au premier temps. */
  crash?: boolean;
}

const r = (a: Note[]) => a;

const INTRO: Bar[] = [
  { section: 'intro', chord: Am, lead: [], crash: true },
  { section: 'intro', chord: F, lead: [] },
  { section: 'intro', chord: G, lead: [] },
  { section: 'intro', chord: E, lead: r([[0, 76, 4], [4, 80, 4], [8, 83, 4], [12, 86, 4]]), fill: true },
];

const VERSE: Bar[] = [
  { section: 'verse', chord: Am, crash: true, lead: r([[0, 76, 2], [3, 76, 1], [4, 74, 2], [6, 72, 2], [8, 74, 6]]) },
  { section: 'verse', chord: F, lead: r([[0, 72, 2], [3, 72, 1], [4, 74, 2], [6, 76, 2], [8, 69, 6]]) },
  { section: 'verse', chord: G, lead: r([[0, 71, 2], [2, 72, 2], [4, 74, 2], [6, 79, 4], [10, 77, 2], [12, 76, 2], [14, 74, 2]]) },
  { section: 'verse', chord: Cmaj, lead: r([[0, 76, 8], [8, 74, 2], [10, 72, 2], [12, 74, 4]]) },
  { section: 'verse', chord: Am, lead: r([[0, 76, 2], [3, 76, 1], [4, 74, 2], [6, 72, 2], [8, 74, 6]]) },
  { section: 'verse', chord: F, lead: r([[0, 72, 2], [3, 72, 1], [4, 74, 2], [6, 76, 2], [8, 77, 2], [10, 79, 2], [12, 81, 4]]) },
  { section: 'verse', chord: G, lead: r([[0, 83, 4], [4, 81, 2], [6, 79, 2], [8, 77, 2], [10, 76, 2], [12, 74, 4]]) },
  { section: 'verse', chord: E, lead: r([[0, 76, 4], [4, 80, 4], [8, 83, 4], [12, 86, 4]]), fill: true },
];

const CHORUS: Bar[] = [
  { section: 'chorus', chord: F, crash: true, lead: r([[0, 76, 2], [2, 77, 2], [4, 79, 2], [6, 81, 6], [12, 79, 2], [14, 77, 2]]) },
  { section: 'chorus', chord: G, lead: r([[0, 79, 4], [4, 74, 4], [8, 79, 2], [10, 81, 2], [12, 83, 4]]) },
  { section: 'chorus', chord: Em, lead: r([[0, 84, 4], [4, 83, 2], [6, 79, 2], [8, 76, 4], [12, 79, 2], [14, 83, 2]]) },
  { section: 'chorus', chord: Am, lead: r([[0, 81, 12], [12, 76, 2], [14, 79, 2]]) },
  { section: 'chorus', chord: F, crash: true, lead: r([[0, 81, 2], [2, 81, 2], [4, 84, 2], [6, 81, 2], [8, 79, 4], [12, 77, 2], [14, 79, 2]]) },
  { section: 'chorus', chord: G, lead: r([[0, 83, 4], [4, 81, 2], [6, 79, 2], [8, 86, 4], [12, 84, 2], [14, 83, 2]]) },
  { section: 'chorus', chord: E, lead: r([[0, 83, 4], [4, 80, 4], [8, 83, 2], [10, 86, 2], [12, 88, 4]]) },
  { section: 'chorus', chord: Am, lead: r([[0, 81, 14]]), fill: true },
];

/** Le morceau : intro, couplet, refrain, puis couplet + refrain en boucle. */
export const SONG: Bar[] = [...INTRO, ...VERSE, ...CHORUS];
export const LOOP_FROM = INTRO.length;

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/**
 * Moteur de la musique. Fonctionne sur un AudioContext (jeu) comme sur un
 * OfflineAudioContext (rendu d'un extrait en fichier).
 */
export class MusicEngine {
  readonly out: GainNode;
  private reverb: ConvolverNode;
  private reverbSend: GainNode;
  private delay: DelayNode;
  private delaySend: GainNode;
  private dist: WaveShaperNode;
  private guitarBus: GainNode;
  private noise: AudioBuffer;

  constructor(private ctx: BaseAudioContext, destination: AudioNode) {
    this.out = ctx.createGain();
    this.out.gain.value = 0.55;
    this.out.connect(destination);

    // Réverbération : réponse impulsionnelle générée (bruit qui décroît, 1,6 s).
    this.reverb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 1.6);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    this.reverb.buffer = ir;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.22;
    this.reverbSend.connect(this.reverb).connect(this.out);

    // Écho de la mélodie (croche pointée), légèrement filtré.
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = STEP * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 2600;
    this.delay.connect(dlp).connect(fb).connect(this.delay);
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = 0.22;
    this.delaySend.connect(this.delay);
    dlp.connect(this.out);

    // Guitare saturée : distorsion douce puis filtre (enlève le grésillement).
    this.dist = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 6) * 0.9;
    }
    this.dist.curve = curve;
    this.dist.oversample = '4x';
    const cab = ctx.createBiquadFilter();
    cab.type = 'lowpass';
    cab.frequency.value = 3200;
    cab.Q.value = 0.8;
    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking';
    mid.frequency.value = 900;
    mid.gain.value = -4;
    this.guitarBus = ctx.createGain();
    this.guitarBus.gain.value = 0.22;
    this.dist.connect(cab).connect(mid).connect(this.guitarBus);
    this.guitarBus.connect(this.out);
    this.guitarBus.connect(this.reverbSend);

    const n = Math.floor(ctx.sampleRate * 0.5);
    this.noise = ctx.createBuffer(1, n, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) nd[i] = Math.random() * 2 - 1;
  }

  /** Programme un pas (double croche) du morceau, à l'instant `t`. */
  scheduleStep(globalStep: number, t: number) {
    const bars = SONG.length;
    let barIdx = Math.floor(globalStep / 16);
    if (barIdx >= bars) barIdx = LOOP_FROM + ((barIdx - LOOP_FROM) % (bars - LOOP_FROM));
    const s = globalStep % 16;
    const bar = SONG[barIdx];
    const chorus = bar.section === 'chorus';
    const intro = bar.section === 'intro';
    const introBar = barIdx;

    // ── Batterie ──
    if (bar.crash && s === 0) this.crash(t);
    if (intro) {
      if (introBar >= 2 && s % 4 === 0) this.kick(t, 0.8);
      if (introBar === 3 && s >= 8 && s % 2 === 0) this.snare(t, 0.4 + (s - 8) * 0.07);
    } else {
      const kicks = chorus ? [0, 3, 6, 8, 11, 14] : [0, 6, 8, 10];
      if (kicks.includes(s)) this.kick(t, 1);
      if (s === 4 || s === 12) this.snare(t, 1);
      if (bar.fill && s >= 12) this.snare(t, 0.55 + (s - 12) * 0.1);
      if (s % 2 === 0) this.hat(t, chorus ? 0.5 : 0.35, chorus && s % 4 === 2);
      else if (!chorus) this.hat(t, 0.15, false);
    }

    // ── Basse : croches qui pompent (octaves au refrain) ──
    if (!intro || introBar >= 2) {
      if (s % 2 === 0) {
        const note = bar.chord.root - 12 + (chorus && s % 4 === 2 ? 12 : 0);
        this.bass(t, note, STEP * 1.8);
      }
    }

    // ── Guitare : accord de puissance en croches au refrain, nappe en blanches au couplet ──
    if (chorus) {
      if (s % 2 === 0) this.powerChord(t, bar.chord.root, STEP * (s % 8 === 6 ? 1.2 : 1.8), s % 8 === 0 ? 1 : 0.75);
    } else if (s === 0 || s === 8) {
      this.pad(t, bar.chord, STEP * 8);
      if (!intro && s === 0) this.powerChord(t, bar.chord.root, STEP * 7, 0.55);
    }

    // ── Arpège (couplet et intro) ──
    if (!chorus) {
      const pattern = [0, 1, 2, 1, 2, 0, 1, 2];
      const note = bar.chord.notes[pattern[s % 8]] + 12 + (s >= 8 ? 12 : 0);
      this.arp(t, note, intro ? 0.08 : 0.055);
    }

    // ── Mélodie ──
    for (const [start, note, len] of bar.lead) {
      if (start === s) this.lead(t, note, len * STEP, chorus);
    }
  }

  // ── Instruments ────────────────────────────────────────────────────────

  private env(g: GainNode, t: number, peak: number, attack: number, hold: number, release: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + Math.max(attack, hold));
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(attack, hold) + release);
    return t + Math.max(attack, hold) + release;
  }

  private kick(t: number, vel: number) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    const g = c.createGain();
    const end = this.env(g, t, 0.7 * vel, 0.002, 0.02, 0.22);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(end + 0.02);
    // clic d'attaque
    this.noiseHit(t, 0.012, 'highpass', 3000, 0.25 * vel, this.out);
  }

  private snare(t: number, vel: number) {
    const c = this.ctx;
    this.noiseHit(t, 0.17, 'bandpass', 2400, 1.6 * vel, this.out, 0.7);
    this.noiseHit(t, 0.17, 'bandpass', 2400, 0.5 * vel, this.reverbSend, 0.7);
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(240, t);
    o.frequency.exponentialRampToValueAtTime(170, t + 0.08);
    const g = c.createGain();
    const end = this.env(g, t, 0.6 * vel, 0.002, 0.01, 0.09);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(end + 0.02);
  }

  private hat(t: number, vel: number, open: boolean) {
    this.noiseHit(t, open ? 0.14 : 0.035, 'highpass', 7000, 0.4 * vel, this.out);
  }

  private crash(t: number) {
    this.noiseHit(t, 1.4, 'highpass', 5000, 0.22, this.out, 0.5);
    this.noiseHit(t, 1.4, 'highpass', 5000, 0.12, this.reverbSend, 0.5);
  }

  private noiseHit(t: number, dur: number, type: BiquadFilterType, freq: number, gain: number, dest: AudioNode, q = 1) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    const end = this.env(g, t, gain, 0.001, 0.003, dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.3);
    src.stop(end + 0.02);
  }

  private bass(t: number, midi: number, dur: number) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = hz(midi);
    const sub = c.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = hz(midi);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1400, t);
    f.frequency.exponentialRampToValueAtTime(380, t + dur);
    f.Q.value = 3;
    const g = c.createGain();
    const end = this.env(g, t, 0.15, 0.004, dur * 0.6, dur * 0.4);
    o.connect(f).connect(g);
    sub.connect(g);
    g.connect(this.out);
    o.start(t);
    sub.start(t);
    o.stop(end + 0.02);
    sub.stop(end + 0.02);
  }

  /** Quinte + octave, deux cordes légèrement désaccordées, dans la distorsion. */
  private powerChord(t: number, root: number, dur: number, vel: number) {
    const c = this.ctx;
    const g = c.createGain();
    const end = this.env(g, t, 0.5 * vel, 0.003, dur * 0.7, dur * 0.5);
    g.connect(this.dist);
    for (const [interval, detune] of [
      [0, -7],
      [0, 7],
      [7, -5],
      [7, 6],
      [12, 0],
    ]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = hz(root + interval);
      o.detune.value = detune;
      o.connect(g);
      o.start(t);
      o.stop(end + 0.02);
    }
  }

  /** Nappe de synthé douce (accord complet), attaque lente. */
  private pad(t: number, chord: Chord, dur: number) {
    const c = this.ctx;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1700;
    const g = c.createGain();
    const end = this.env(g, t, 0.045, 0.12, dur * 0.85, 0.35);
    f.connect(g);
    g.connect(this.out);
    g.connect(this.reverbSend);
    for (const n of chord.notes) {
      for (const d of [-9, 9]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz(n + 12);
        o.detune.value = d;
        o.connect(f);
        o.start(t);
        o.stop(end + 0.02);
      }
    }
  }

  private arp(t: number, midi: number, vel: number) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = hz(midi);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 3000;
    const g = c.createGain();
    const end = this.env(g, t, vel, 0.003, 0.02, STEP * 0.9);
    o.connect(f).connect(g);
    g.connect(this.out);
    g.connect(this.delaySend);
    o.start(t);
    o.stop(end + 0.02);
  }

  /** Mélodie : deux dents de scie désaccordées + carré à l'octave, vibrato qui arrive après l'attaque. */
  private lead(t: number, midi: number, dur: number, chorus: boolean) {
    const c = this.ctx;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(chorus ? 4200 : 3200, t);
    f.Q.value = 1.5;
    const g = c.createGain();
    const peak = chorus ? 0.5 : 0.4;
    const end = this.env(g, t, peak, 0.012, Math.max(0.03, dur - 0.06), 0.12);
    f.connect(g);
    g.connect(this.out);
    g.connect(this.delaySend);
    g.connect(this.reverbSend);
    const lfo = c.createOscillator();
    lfo.frequency.value = 6;
    const lfoGain = c.createGain();
    lfoGain.gain.setValueAtTime(0, t);
    if (dur > STEP * 3) lfoGain.gain.linearRampToValueAtTime(18, t + Math.min(dur, 0.6));
    lfo.connect(lfoGain);
    lfo.start(t);
    lfo.stop(end + 0.02);
    const voices: [OscillatorType, number, number][] = [
      ['sawtooth', 0, -8],
      ['sawtooth', 0, 8],
      ['square', 12, 0],
    ];
    for (const [type, oct, det] of voices) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = hz(midi + oct);
      o.detune.value = det;
      lfoGain.connect(o.detune);
      const vg = c.createGain();
      vg.gain.value = type === 'square' ? 0.25 : 0.5;
      o.connect(vg).connect(f);
      // léger glissé depuis un demi-ton en dessous, typique des synthés d'anime
      o.frequency.setValueAtTime(hz(midi + oct - 0.6), t);
      o.frequency.exponentialRampToValueAtTime(hz(midi + oct), t + 0.035);
      o.start(t);
      o.stop(end + 0.02);
    }
  }
}

/** Joue la musique en temps réel (programmation avec un peu d'avance). */
export class MusicPlayer {
  private engine: MusicEngine | null = null;
  private timer: number | null = null;
  private step = 0;
  private next = 0;

  constructor(private ctx: AudioContext, private destination: AudioNode) {}

  get playing() {
    return this.timer !== null;
  }

  start() {
    if (this.timer !== null) return;
    this.engine ??= new MusicEngine(this.ctx, this.destination);
    this.engine.out.gain.cancelScheduledValues(this.ctx.currentTime);
    this.engine.out.gain.setValueAtTime(0.55, this.ctx.currentTime);
    this.step = 0;
    this.next = this.ctx.currentTime + 0.08;
    this.timer = window.setInterval(() => this.tick(), 25);
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    if (this.engine) {
      const t = this.ctx.currentTime;
      this.engine.out.gain.setTargetAtTime(0, t, 0.15);
    }
  }

  private tick() {
    while (this.next < this.ctx.currentTime + 0.2) {
      this.engine!.scheduleStep(this.step, this.next);
      this.step++;
      this.next += STEP;
    }
  }
}
