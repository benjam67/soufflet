// Machine à états du geste de gifle : appui maintenu (armer) puis swipe sans lever le doigt.
// Pure : on lui passe des temps (ms) et des positions écran (px CSS).
import { FIGHTERS, SLAP, type FighterId } from '../config/balance';
import { chargeAt, isOverheated, swipeAngle, timeToFull, type ChargeSpeed } from './slap';

/** Mouvement toléré pendant l'armement avant de considérer que le swipe commence. */
export const SWIPE_DEAD_ZONE_PX = 10;
/** Durée maximale supposée entre le début réel du mouvement et le premier événement reçu. */
export const SWIPE_START_FRAME_MS = 16;

export type GesturePhase = 'idle' | 'charging' | 'swiping' | 'done';

export type GestureOutcome =
  | { type: 'slap'; charge: number; speed: number; angle: number; dx: number; dy: number; durationMs: number }
  | { type: 'selfslap'; charge: 100 }
  | { type: 'cancel'; reason: 'no-swipe' | 'too-short' | 'wrong-direction' };

interface Sample {
  t: number;
  x: number;
  y: number;
}

export class SlapGesture {
  phase: GesturePhase = 'idle';
  private press?: Sample;
  private still?: Sample;
  private swipeOrigin?: Sample;
  private frozenCharge = 0;
  readonly chargeTimeMs: number;

  /**
   * @param fighter perso qui gifle (temps de montée de la jauge)
   * @param direction +1 si l'adversaire est à droite, -1 s'il est à gauche
   * @param speed vitesse de la jauge : 1 = normale, ou courbe irrégulière (état sonné)
   */
  constructor(
    fighter: FighterId,
    readonly direction: 1 | -1,
    readonly speed: ChargeSpeed = 1,
  ) {
    this.chargeTimeMs = FIGHTERS[fighter].chargeTimeMs;
    this.fullAt = timeToFull(this.chargeTimeMs, speed);
  }

  /** Temps d'appui pour remplir la jauge (dépend de la courbe). */
  readonly fullAt: number;

  /** Charge actuelle en % (figée dès que le swipe a commencé). */
  charge(t: number): number {
    if (this.phase === 'swiping' || this.phase === 'done') return this.frozenCharge;
    if (this.phase !== 'charging' || !this.press) return 0;
    const held = t - this.press.t;
    // Jauge pleine : inutile d'intégrer la courbe au-delà.
    if (held >= this.fullAt) return 100;
    return chargeAt(held, this.chargeTimeMs, this.speed);
  }

  down(t: number, x: number, y: number): void {
    if (this.phase !== 'idle') return;
    this.phase = 'charging';
    this.press = { t, x, y };
    this.still = { t, x, y };
  }

  move(t: number, x: number, y: number): GestureOutcome | null {
    if (this.phase === 'charging') {
      const over = this.update(t);
      if (over) return over;
      const p = this.press!;
      if (Math.hypot(x - p.x, y - p.y) <= SWIPE_DEAD_ZONE_PX) {
        this.still = { t, x, y };
      } else {
        // Le swipe commence : on fige la charge à cet instant. Les écrans tactiles
        // n'envoient d'événement que si le doigt bouge : le dernier point immobile
        // peut dater de l'appui. Le mouvement a commencé au plus une image avant.
        const s = this.still!;
        this.swipeOrigin = { x: s.x, y: s.y, t: Math.max(s.t, t - SWIPE_START_FRAME_MS) };
        this.frozenCharge = this.charge(this.swipeOrigin.t);
        this.phase = 'swiping';
      }
    }
    return null;
  }

  /** À appeler à chaque image : déclenche la surchauffe pendant l'armement. */
  update(t: number): GestureOutcome | null {
    if (this.phase !== 'charging' || !this.press) return null;
    if (t - this.press.t > this.fullAt && isOverheated(t - this.press.t, this.chargeTimeMs, this.speed)) {
      this.phase = 'done';
      this.frozenCharge = 100;
      return { type: 'selfslap', charge: 100 };
    }
    return null;
  }

  up(t: number, x: number, y: number): GestureOutcome | null {
    if (this.phase === 'charging') {
      const over = this.update(t);
      if (over) return over;
      this.phase = 'done';
      return { type: 'cancel', reason: 'no-swipe' };
    }
    if (this.phase !== 'swiping') return null;
    this.phase = 'done';
    const o = this.swipeOrigin!;
    const dx = (x - o.x) * this.direction;
    const dy = y - o.y;
    if (dx <= 0) return { type: 'cancel', reason: 'wrong-direction' };
    if (dx < SLAP.minSwipePx) return { type: 'cancel', reason: 'too-short' };
    const durationMs = Math.max(1, t - o.t);
    return {
      type: 'slap',
      charge: this.frozenCharge,
      speed: Math.hypot(dx, dy) / durationMs,
      angle: swipeAngle(dx, dy),
      dx,
      dy,
      durationMs,
    };
  }

  reset(): void {
    this.phase = 'idle';
    this.press = this.still = this.swipeOrigin = undefined;
    this.frozenCharge = 0;
  }
}
