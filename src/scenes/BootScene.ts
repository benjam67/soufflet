import Phaser from 'phaser';
import { HABITUES } from '../logic/layout';
import { loadFonts } from '../ui/theme';
import { bakeAll } from '../fx/bake';
import type { FightData, Mode } from './FightScene';
import type { AiLevel } from '../logic/ai';

export const POSES = ['idle', 'windup', 'swing', 'slap', 'hit', 'dazed', 'victory', 'selfslap'] as const;
export type Pose = (typeof POSES)[number];
export const fighterKey = (id: string, pose: Pose) => `${id}_${pose}`;

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    const { width, height } = this.scale;
    const barW = Math.min(420, width * 0.5);
    const frame = this.add.rectangle(width / 2, height / 2, barW + 8, 26, 0x1a1020).setStrokeStyle(4, 0xfff7e8);
    const bar = this.add.rectangle(width / 2 - barW / 2, height / 2, 1, 18, 0xffc93c).setOrigin(0, 0.5);
    this.load.on('progress', (p: number) => (bar.width = Math.max(1, barW * p)));
    this.load.on('complete', () => {
      frame.destroy();
      bar.destroy();
    });

    this.load.setBaseURL(import.meta.env.BASE_URL);
    this.load.setPath('assets/');
    this.load.image('decor', 'bar/decor.webp');
    this.load.image('patron', 'bar/patron.webp');
    for (const h of HABITUES) this.load.image(`habitue_${h}`, `bar/habitues/${h}.webp`);
    for (const id of ['bernard', 'lola']) {
      for (const pose of POSES) this.load.image(fighterKey(id, pose), `characters/${id}/${pose}.webp`);
    }
  }

  async create() {
    await loadFonts();
    // Tous les textes à gros contour et les effets sont tracés une fois ici, jamais pendant le jeu.
    bakeAll(this);
    this.scene.start('Fight', fightDataFromUrl(location.search));
  }
}

/**
 * Paramètres d'URL : `?mode=training`, `?mode=solo&level=easy|normal|hard` (contre l'IA), `?autoplay=1` (IA contre IA),
 * `?speed=4` (tout accélérer), `?seed=42` (IA reproductible). Par défaut : match à deux.
 */
export function fightDataFromUrl(search: string): FightData {
  const q = new URLSearchParams(search);
  const m = q.get('mode');
  const mode: Mode = q.get('autoplay') === '1' ? 'autoplay' : m === 'training' ? 'training' : m === 'solo' ? 'solo' : 'match';
  const lv = q.get('level');
  const level: AiLevel = lv === 'easy' || lv === 'hard' ? lv : 'normal';
  const speed = Number(q.get('speed'));
  const seed = Number(q.get('seed'));
  return {
    mode,
    level,
    speed: Number.isFinite(speed) && speed > 0 ? Math.min(speed, 20) : 1,
    seed: Number.isFinite(seed) && q.has('seed') ? seed : undefined,
  };
}
