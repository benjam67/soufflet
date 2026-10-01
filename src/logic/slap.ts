// Règles pures de la gifle : charge, zone dorée, surchauffe, swipe, dégâts.
// Aucune dépendance à Phaser : tout est testable seul.
import { FIGHTERS, SLAP, type FighterId } from '../config/balance';

/** Charge en % (0–100) après `heldMs` millisecondes d'appui, pour un temps de montée donné. */
export function chargeAt(heldMs: number, chargeTimeMs: number, speedFactor = 1): number {
  if (heldMs <= 0) return 0;
  return Math.min(100, (heldMs * speedFactor * 100) / chargeTimeMs);
}

/** La charge est-elle dans la zone dorée (bornes incluses) ? */
export function isGolden(charge: number, zone: readonly [number, number]): boolean {
  return charge >= zone[0] && charge <= zone[1];
}

/** Surchauffe : la jauge est restée à 100 % plus longtemps que la tolérance. */
export function isOverheated(heldMs: number, chargeTimeMs: number, speedFactor = 1): boolean {
  return heldMs > chargeTimeMs / speedFactor + SLAP.overheatGraceMs;
}

/** Facteur V : linéaire de 0,8 à 1,3 entre 0,3 et 2,5 px/ms, borné aux extrémités. */
export function speedFactor(pxPerMs: number): number {
  const { minPxPerMs, maxPxPerMs, minFactor, maxFactor } = SLAP.speed;
  const t = Math.min(1, Math.max(0, (pxPerMs - minPxPerMs) / (maxPxPerMs - minPxPerMs)));
  return minFactor + t * (maxFactor - minFactor);
}

/** Facteur P selon l'angle du swipe avec l'horizontale (en degrés, 0–90). */
export function precisionFactor(angleDeg: number): number {
  const a = Math.abs(angleDeg);
  for (const step of SLAP.precision) if (a < step.maxAngleDeg) return step.factor;
  return SLAP.precision[SLAP.precision.length - 1].factor;
}

/** Angle (0–90°) d'un déplacement avec l'horizontale. */
export function swipeAngle(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  return (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;
}

export interface SlapInput {
  attacker: FighterId;
  defender: FighterId;
  /** Charge figée au début du swipe, en %. */
  charge: number;
  /** Vitesse du swipe en px/ms (px écran, CSS). */
  speed: number;
  /** Angle du swipe avec l'horizontale, en degrés. */
  angle: number;
  /** Multiplicateur supplémentaire (gifles spéciales, phase 5). */
  extra?: number;
}

export interface SlapResult {
  damage: number;
  raw: number;
  critical: boolean;
  factors: { B: number; C: number; V: number; P: number; K: number; Rd: number };
  /** Qualité du contact, pour les réactions : nette, effleurée ou ratée. */
  contact: 'clean' | 'grazed' | 'missed';
}

/** D = B × C/100 × V × P × K × R_d, arrondi à l'entier (au moins 1 si la gifle part). */
export function computeSlap(input: SlapInput): SlapResult {
  const a = FIGHTERS[input.attacker];
  const d = FIGHTERS[input.defender];
  const C = Math.max(0, Math.min(100, input.charge));
  const critical = isGolden(C, a.goldenZone);
  const factors = {
    B: a.base,
    C,
    V: speedFactor(input.speed),
    P: precisionFactor(input.angle),
    K: critical ? SLAP.criticalMultiplier : 1,
    Rd: d.resistance,
  };
  const raw = factors.B * (factors.C / 100) * factors.V * factors.P * factors.K * factors.Rd * (input.extra ?? 1);
  const damage = C > 0 ? Math.max(1, Math.round(raw)) : 0;
  const contact = factors.P >= 1 ? 'clean' : factors.P >= 0.7 ? 'grazed' : 'missed';
  return { damage, raw, critical, factors, contact };
}
