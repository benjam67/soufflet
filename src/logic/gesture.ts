// Machine à états du geste de gifle : appui maintenu (armer) puis swipe sans lever le doigt.
// Pure : on lui passe des temps (ms) et des positions écran (px CSS).
import { DEFENSE, FIGHTERS, SLAP, type FighterId } from '../config/balance';
import { chargeAt, isOverheated, swipeAngle, timeToFull, type ChargeSpeed } from './slap';

/** Mouvement toléré pendant l'armement avant de considérer que le swipe commence. */
export const SWIPE_DEAD_ZONE_PX = 10;
/** Durée maximale supposée entre le début réel du mouvement et le premier événement reçu. */
export const SWIPE_START_FRAME_MS = 16;

export type GesturePhase = 'idle' | 'charging' | 'swiping' | 'done';

export type GestureOutcome =
  | {
      type: 'slap';
      charge: number;
      speed: number;
      angle: number;
      dx: number;
      dy: number;
      durationMs: number;
      /** Feinte : temps pendant lequel la gifle a été retenue, doigt posé, après le swipe (ms). */
      heldMs: number;
    }
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
  /** Point le plus avancé du swipe vers l'adversaire (c'est lui qui donne vitesse et angle). */
  private far?: Sample & { dx: number; dy: number };
  /** Instant où le swipe est devenu valide (assez long) : la gifle est armée, prête à partir. */
  armedAt: number | null = null;
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
        this.track(t, x, y);
      }
    } else if (this.phase === 'swiping') {
      this.track(t, x, y);
      return this.update(t);
    }
    return null;
  }

  /** Suit le swipe : garde le point le plus avancé et note l'instant où la gifle est armée. */
  private track(t: number, x: number, y: number) {
    const o = this.swipeOrigin!;
    const dx = (x - o.x) * this.direction;
    if (!this.far || dx > this.far.dx) this.far = { t, x, y, dx, dy: y - o.y };
    if (this.armedAt === null && dx >= SLAP.minSwipePx) this.armedAt = t;
  }

  /** La gifle est armée et retenue (doigt encore posé après un swipe valide) : c'est une feinte en cours. */
  get armed(): boolean {
    return this.phase === 'swiping' && this.armedAt !== null;
  }

  private release(t: number): GestureOutcome {
    this.phase = 'done';
    const o = this.swipeOrigin!;
    const f = this.far!;
    const durationMs = Math.max(1, f.t - o.t);
    return {
      type: 'slap',
      charge: this.frozenCharge,
      speed: Math.hypot(f.dx, f.dy) / durationMs,
      angle: swipeAngle(f.dx, f.dy),
      dx: f.dx,
      dy: f.dy,
      durationMs,
      heldMs: Math.max(0, t - f.t),
    };
  }

  /** La jauge est-elle en surchauffe à l'instant `t` ? (sans rien déclencher) */
  overheatedAt(t: number): boolean {
    if (this.phase !== 'charging' || !this.press) return false;
    return t - this.press.t > this.fullAt && isOverheated(t - this.press.t, this.chargeTimeMs, this.speed);
  }

  /**
   * À appeler à chaque image : déclenche la surchauffe pendant l'armement, et fait partir
   * toute seule une gifle retenue trop longtemps (feinte limitée dans le temps).
   */
  update(t: number): GestureOutcome | null {
    if (this.phase === 'swiping' && this.armedAt !== null && t - this.armedAt > DEFENSE.feintMaxMs) return this.release(t);
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
    this.track(t, x, y);
    const f = this.far!;
    if (f.dx <= 0) {
      this.phase = 'done';
      return { type: 'cancel', reason: 'wrong-direction' };
    }
    if (f.dx < SLAP.minSwipePx) {
      this.phase = 'done';
      return { type: 'cancel', reason: 'too-short' };
    }
    return this.release(t);
  }

  reset(): void {
    this.phase = 'idle';
    this.press = this.still = this.swipeOrigin = this.far = undefined;
    this.armedAt = null;
    this.frozenCharge = 0;
  }
}

/** Ce que fait celui qui reçoit : esquive (swipe arrière) ou garde de rage (swipe vers le bas). */
export type DefenseMove = { kind: 'dodge' | 'guard'; at: number };

/**
 * Geste de celui qui reçoit. Un seul essai par gifle : le premier swipe compte,
 * qu'il soit bien placé ou non (c'est ce qui rend la feinte utile).
 */
export class DefenseGesture {
  move: DefenseMove | null = null;
  private start = new Map<number, Sample>();

  /** @param back sens « arrière » pour ce joueur : -1 s'il est à gauche, +1 s'il est à droite. */
  constructor(readonly back: 1 | -1) {}

  down(id: number, t: number, x: number, y: number) {
    if (this.move) return;
    this.start.set(id, { t, x, y });
  }

  /** Renvoie le geste dès qu'il est reconnu (une seule fois). */
  track(id: number, t: number, x: number, y: number): DefenseMove | null {
    const s = this.start.get(id);
    if (!s || this.move) return null;
    const dx = (x - s.x) * this.back;
    const dy = y - s.y;
    if (dx >= DEFENSE.minSwipePx && dx >= Math.abs(dy)) this.move = { kind: 'dodge', at: t };
    else if (dy >= DEFENSE.minSwipePx && dy > Math.abs(dx)) this.move = { kind: 'guard', at: t };
    return this.move;
  }

  up(id: number, t: number, x: number, y: number): DefenseMove | null {
    const m = this.track(id, t, x, y);
    this.start.delete(id);
    return m;
  }
}
