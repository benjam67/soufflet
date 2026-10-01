// IA : joue avec les mêmes règles que le joueur, en simulant un humain.
// L'erreur de timing est en millisecondes (comme un réflexe), pas en % :
// une jauge plus rapide rend la zone dorée plus difficile à attraper.
import { FIGHTERS, MATCH, SLAP, type FighterId } from '../config/balance';
import { chargeAt, isOverheated } from './slap';
import { gaussian, uniform, type Rng } from './rng';
import type { TurnAction } from './match';

export interface AiProfile {
  label: string;
  /** Écart type de l'erreur de relâchement autour du centre de la zone dorée (ms). */
  timingSdMs: number;
  /** Décalage moyen du relâchement (ms) : positif = trop tard. */
  timingBiasMs: number;
  /** Vitesse du swipe (px/ms) : moyenne et écart type. */
  speedMean: number;
  speedSd: number;
  /** Écart type de l'angle du swipe (degrés). */
  angleSdDeg: number;
  /** Délai avant de poser le doigt (ms). */
  reactionMs: [number, number];
  /** Durée du swipe lui-même (ms). */
  swipeMs: [number, number];
}

export const AI_PROFILES = {
  /** Joueur moyen : référence de l'équilibrage. */
  average: {
    label: 'Joueur moyen',
    timingSdMs: 110,
    timingBiasMs: 0,
    speedMean: 1.5,
    speedSd: 0.5,
    angleSdDeg: 14,
    reactionMs: [350, 900],
    swipeMs: [90, 220],
  },
} satisfies Record<string, AiProfile>;

export interface AiDecision {
  action: TurnAction;
  /** Délai avant l'appui, durée d'appui et durée du swipe (pour l'animer à l'écran). */
  startDelayMs: number;
  holdMs: number;
  swipeMs: number;
}

/** Décide d'un tour complet pour `fighter`, avec la jauge éventuellement accélérée/ralentie. */
export function aiDecide(rng: Rng, fighter: FighterId, profile: AiProfile, chargeSpeed = 1): AiDecision {
  const f = FIGHTERS[fighter];
  const tFull = f.chargeTimeMs / chargeSpeed;
  const center = (f.goldenZone[0] + f.goldenZone[1]) / 2;
  const aim = (center / 100) * tFull;
  const holdMs = Math.max(60, aim + profile.timingBiasMs + gaussian(rng, 0, profile.timingSdMs));
  const startDelayMs = uniform(rng, profile.reactionMs[0], profile.reactionMs[1]);
  const swipeMs = uniform(rng, profile.swipeMs[0], profile.swipeMs[1]);

  if (startDelayMs + Math.min(holdMs, tFull + SLAP.overheatGraceMs) + swipeMs > MATCH.turnTimeMs) {
    return { action: { type: 'timeout' }, startDelayMs, holdMs, swipeMs };
  }
  if (isOverheated(holdMs, f.chargeTimeMs, chargeSpeed)) {
    return { action: { type: 'selfslap' }, startDelayMs, holdMs: tFull + SLAP.overheatGraceMs + 1, swipeMs: 0 };
  }
  const charge = chargeAt(holdMs, f.chargeTimeMs, chargeSpeed);
  const speed = Math.min(4, Math.max(0.15, gaussian(rng, profile.speedMean, profile.speedSd)));
  const angle = Math.min(80, Math.abs(gaussian(rng, 0, profile.angleSdDeg)));
  return { action: { type: 'slap', charge, speed, angle }, startDelayMs, holdMs, swipeMs };
}
